import { resolveSessionPath } from "@/lib/session-reader";
import { getRpcSession, startRpcSession, type AgentSessionWrapper } from "@/lib/rpc-manager";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { getSessionMeta } from "@/lib/session-meta";
import { assertCanReadSessionScoped } from "@/lib/team-auth";
import { auditLog } from "@/lib/audit-log";
import { getUserHighestRole } from "@/lib/user-role";
import { NextResponse, type NextRequest } from "next/server";
import { enforceNotMustChange } from "@/lib/must-change-password";
import { decrementUserSessionCap } from "@/lib/session-cap";

export const dynamic = "force-dynamic";

/**
 * SSE 引用计数表:同一个 session 可能被多个客户端订阅(同浏览器多标签、
 * workbench 切 session 又切回来),只在最后一个 SSE 断开时才 destroy runtime。
 *
 * 与 wrapper 内置 10 分钟 idle timer 正交:
 *   - refCount:防"最后一个 SSE 客户端走了"就被早杀;
 *   - idle timer:防"refCount 卡住"(客户端挂着不走但事件流已死)。
 *
 * 模块作用域单例:Next.js dev server 进程内全局共享,
 * force-dynamic 路由在同一进程下 ID 串行,无需担心并发。
 */
const sseRefCount = new Map<string, number>();

function incRefCount(sessionId: string): number {
  const next = (sseRefCount.get(sessionId) ?? 0) + 1;
  sseRefCount.set(sessionId, next);
  return next;
}

/**
 * 把本连接从 refCount 释放。返回:
 *   - `released`: 是否**真的**释放了一个引用(首次 decrement)。
 *   - `remaining`: 释放后剩余引用数(0 = 最后一个 SSE 客户端走了)。
 * 两者独立,这样 cleanup 既能知道"我是不是第一个走到这里的路径",
 * 又能根据 remaining 判断要不要 destroy。
 */
function decRefCountOnce(sessionId: string): { released: boolean; remaining: number } {
  const cur = sseRefCount.get(sessionId) ?? 0;
  if (cur <= 0) {
    // 已经归零 / 从未 inc 过。说明本连接之前已经被释放过。
    return { released: false, remaining: 0 };
  }
  if (cur <= 1) {
    sseRefCount.delete(sessionId);
    return { released: true, remaining: 0 };
  }
  const next = cur - 1;
  sseRefCount.set(sessionId, next);
  return { released: true, remaining: next };
}

/**
 * cap 扣减 idempotency:同一个 wrapper 实例的生命周期里,events route 只能扣一次。
 * 用 WeakSet 让 wrapper 被 GC 时自动清掉,不会泄漏。
 *
 * 为什么不只靠 route 内的 `destroyed` 标志?因为同一 wrapper 可能先后被多个
 * SSE 客户端订阅,每个 SSE 都"应该"在最后一次 destroy 时扣一次 cap;
 * 但 LRU 驱逐或 idle timer 也可能已经扣过,这时 abort 路径再扣就重复。
 * 用 wrapper-instance 级别去重,可以跨多条 SSE 连接共享同一扣减记账。
 */
const capDecrementedFor = new WeakSet<AgentSessionWrapper>();

function safeDecrementCap(userId: string, wrapper: AgentSessionWrapper | undefined): void {
  if (!userId || !wrapper) return;
  if (capDecrementedFor.has(wrapper)) return;
  capDecrementedFor.add(wrapper);
  decrementUserSessionCap(userId);
}

// GET /api/agent/[id]/events - SSE stream of agent events
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const gate = enforceNotMustChange(req);
  if (gate) return gate;

  const userId = req.headers.get("x-user-id");
  if (!userId) return new NextResponse("auth required", { status: 401 });

  // 找用户的最高 role（OWNER > ADMIN > MEMBER）
  const userRole = await getUserHighestRole(userId);

  // M2.4: team-scoped authorization. Returns reason alongside the
  // boolean so the route can write audit log entries later.
  const meta = getSessionMeta(id);
  const decision = await assertCanReadSessionScoped(userId, userRole, meta, id);
  if (!decision.allowed) {
    // M2.4 audit: every cross-team or otherwise-denied session read
    // attempt is logged for incident response. The dedupe window in
    // auditLog coalesces a misbehaving client that retries a denied
    // request 100/sec into ~1 row / 5s.
    void auditLog({
      userId,
      action: "session.access_denied",
      resourceType: "session",
      resourceId: id,
      metadata: {
        path: "/api/agent/[id]/events",
        reason: decision.reason,
        sessionTeamId: meta?.teamId ?? null,
        sessionOwnerId: meta?.userId ?? null,
      },
    });
    return new NextResponse("forbidden", { status: 403 });
  }

  // Fast path: already-running session
  let session = getRpcSession(id);
  if (!session || !session.isAlive()) {
    const filePath = await resolveSessionPath(id);
    if (!filePath) {
      return new Response("Session not found", { status: 404 });
    }
    const cwd = SessionManager.open(filePath).getHeader()?.cwd ?? process.cwd();
    try {
      ({ session } = await startRpcSession(id, filePath, cwd));
    } catch (error) {
      return new Response(`Failed to start agent: ${error}`, { status: 500 });
    }
  }

  // 捕获本连接的 wrapper 引用,避免重连后 cleanup 误杀新 wrapper。
  // 一旦本路由 start() 拿到这个 session,在它的整个生命周期里 cleanup
  // 都只对捕获的这一个 wrapper 做 destroy 判断。
  const capturedWrapper = session;

  const stream = new ReadableStream({
    start(controller) {
      const encode = (data: unknown) => {
        const text = `data: ${JSON.stringify(data)}\n\n`;
        controller.enqueue(new TextEncoder().encode(text));
      };

      // Send initial connected event
      encode({ type: "connected", sessionId: id });

      // Capture the userId from middleware-injected header for cleanup accounting.
      // The route handler already validated x-user-id at line 22; reuse it for
      // the cap decrement on disconnect.
      const sessionUserId = req.headers.get("x-user-id") ?? "";

      // SSE 引用计数 +1。同 session 多客户端订阅时,只有最后一个断开才 destroy。
      incRefCount(id);

      // 本连接级幂等门:cleanup 和 session.onDestroy 谁先触发,谁负责
      // 释放 refCount / 关 controller / (remaining=0 时) destroy runtime。
      // 后续路径看到 `released` 已 true 直接 no-op。
      let released = false;
      let destroyed = false;
      const releaseOnce = (): { wasFirst: boolean; remaining: number } => {
        if (released) return { wasFirst: false, remaining: 0 };
        released = true;
        const { remaining } = decRefCountOnce(id);
        return { wasFirst: true, remaining };
      };
      // cap 扣减与 wrapper 真实销毁绑定,不绑定到具体清理路径。
      // - 如果 wrapper 已被 idle/LRU 销毁(capturedWrapper.isAlive() === false),
      //   本连接路径里 wrapper 不会再被 destroy,但 cap 必须扣;
      // - 如果 wrapper 还活着,留给 destroySession() 走 destroy 路径统一扣。
      // safeDecrementCap 内部用 WeakSet 去重,多次调用安全。
      const capIfAlreadyDestroyed = () => {
        if (!capturedWrapper.isAlive()) {
          safeDecrementCap(sessionUserId, capturedWrapper);
        }
      };
      const destroySession = () => {
        if (destroyed) return;
        destroyed = true;
        safeDecrementCap(sessionUserId, capturedWrapper);
        // 只 destroy 我们捕获的这一份 wrapper,不要 `getRpcSession(id)` —
        // 那个可能返回重连后的新 wrapper,会误杀。
        try {
          if (capturedWrapper.isAlive()) capturedWrapper.destroy();
        } catch {
          // wrapper 已被 idle timer / LRU 兜底销毁,这里吞掉就行。
        }
      };

      const unsubscribe = session.onEvent((event) => {
        encode(event);
      });

      // wrapper 兜底销毁(idle timer / LRU)回调。M4:onDestroy 现在返回
      // 解绑函数,所以 cleanup 关闭时调一下避免 stale 闭包。
      const unbindDestroyNotify = session.onDestroy(() => {
        const { wasFirst } = releaseOnce();
        if (!wasFirst) return;
        // 兜底销毁:wrapper 已经没了,wrapper 内部 destroy() 会扣 cap /
        // 移除 registry;我们这条 SSE 路径**不再重复 destroy**,但要负责
        // 关闭 controller 并补一次 cap 扣减(因为 destroySession 没机会跑)。
        capIfAlreadyDestroyed();
        try { controller.close(); } catch { /* already closed */ }
      });

      // Heartbeat every 30s to prevent server/proxy timeout (Next.js default ~120-150s)
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(new TextEncoder().encode(":\n\n"));
        } catch {
          // controller already closed
        }
      }, 30_000);

      // Cleanup when client disconnects.
      // 改:不再"AGGRESSIVE destroy on disconnect"。改成引用计数归零才 destroy,
      // 防止"同 session 多 SSE 客户端时第一个断开把 runtime 干掉"。
      //
      // 历史事故:旧的 AGGRESSIVE 设计(dev 直接 close EventSource → destroy
      // runtime)曾把 dev server RSS 1.7→8GB,因为反复创建/销毁触发大量 GC;
      // 现在改成 refCount + 10 分钟 idle timer 双层防线:
      //   - refCount 防多客户端场景下被早杀;
      //   - idle timer(AgentSessionWrapper 内部)防事件流彻底静默后 refCount
      //     卡住不归零。
      const cleanup = () => {
        clearInterval(heartbeat);
        unsubscribe();
        unbindDestroyNotify();
        const { wasFirst, remaining } = releaseOnce();
        if (!wasFirst) return;
        // wrapper 兜底销毁可能已经先 onDestroy 抢走了 releaseOnce 并补过 cap,
        // 但 cleanup 路径仍要兜底:若 wrapper 已死但 onDestroy 没补上 cap,
        // 这里补一次。WeakSet 保证不会重复扣。
        capIfAlreadyDestroyed();
        try { controller.close(); } catch { /* already closed */ }
        if (remaining === 0) {
          // 最后一个 SSE 客户端走了,真的可以 destroy 了
          destroySession();
        }
        // remaining > 0:还有别的客户端在订阅,保留 runtime
      };

      // Detect client disconnect via abort signal.
      // 关键:必须在 incRefCount 之后注册,否则 inc 后 → signal 同步 aborted
      // → 没有 listener 补发事件 → refCount 永远不归零。
      req.signal?.addEventListener("abort", cleanup);
      // 同时处理一种边界情况:addEventListener 之前 signal 已经是 aborted 状态
      // (罕见但可能在某些 fetch 实现里出现),立即同步清理。
      if (req.signal?.aborted) {
        cleanup();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
