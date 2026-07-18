import { NextResponse, type NextRequest } from "next/server";
import { readdir, stat } from "fs/promises";
import { join } from "path";
import { getRpcSession } from "@/lib/rpc-manager";
import { getSessionMeta } from "@/lib/session-meta";
import { assertCanReadSessionScoped } from "@/lib/team-auth";
import { getUserHighestRole } from "@/lib/user-role";
import { enforceNotMustChange } from "@/lib/must-change-password";
import { assertWithinRoot, PathTraversalError } from "@/lib/path-safety";

export const dynamic = "force-dynamic";

/**
 * GET /api/agent/[id]/files?path=relative/dir
 *
 * 列 session 工作区内的目录(只列,不递归)。
 *
 * 鉴权: 与 /api/agent/sessions 一致 — 走 assertCanReadSessionScoped,
 * team scope + SessionShare 都被尊重。
 *
 * cwd 来源: 优先 wrapper.cwd(runtime alive 时),否则 SessionManager.listAll()
 * 查持久化的 SessionInfo.cwd。两者都拿不到 → 404(session 不可浏览)。
 *
 * 安全:
 * - path 必须相对,assertWithinRoot 防 ../ 与绝对路径
 * - 过滤常见噪声目录(.git / node_modules / .next / dist / .DS_Store)
 * - 大目录限制 1000 项,超过截断 + warn
 *
 * 响应: { code, data: { items: Array<{ name, path, isDir, size?, modifiedAt? }> } }
 */
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".next",
  "dist",
  "build",
  ".turbo",
  ".cache",
  "coverage",
  ".DS_Store",
]);

const MAX_ENTRIES = 1000;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const gate = enforceNotMustChange(req);
  if (gate) return gate;

  const userId = req.headers.get("x-user-id");
  if (!userId) {
    return NextResponse.json({ error: "auth required" }, { status: 401 });
  }

  const { id: sessionId } = await params;

  // 鉴权 — 与 /api/agent/sessions 同语义
  const meta = getSessionMeta(sessionId);
  const userRole = await getUserHighestRole(userId);
  const decision = await assertCanReadSessionScoped(
    userId,
    userRole,
    meta,
    sessionId,
  );
  if (!decision.allowed) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // 拿 cwd — 优先 runtime,否则从 SessionManager.listAll 读持久化数据
  const wrapper = getRpcSession(sessionId);
  let cwd = wrapper?.cwd ?? "";
  if (!cwd) {
    try {
      const { SessionManager } = await import("@earendil-works/pi-coding-agent");
      const all = await SessionManager.listAll();
      const found = all.find((s) => s.id === sessionId);
      cwd = found?.cwd ?? "";
    } catch {
      cwd = "";
    }
  }
  if (!cwd) {
    return NextResponse.json(
      { error: "session has no working directory (not browsable)" },
      { status: 404 },
    );
  }

  // 解析 query.path(默认 cwd 根)
  const url = new URL(req.url);
  const relPath = url.searchParams.get("path") ?? "";

  let absDir: string;
  try {
    absDir = assertWithinRoot(relPath, cwd);
  } catch (e) {
    if (e instanceof PathTraversalError) {
      return NextResponse.json({ error: "path outside working directory" }, { status: 400 });
    }
    return NextResponse.json({ error: "invalid path" }, { status: 400 });
  }

  // 必须是目录
  let dirStat;
  try {
    dirStat = await stat(absDir);
  } catch {
    return NextResponse.json({ error: "directory not found" }, { status: 404 });
  }
  if (!dirStat.isDirectory()) {
    return NextResponse.json({ error: "not a directory" }, { status: 400 });
  }

  // 列目录
  let entries;
  try {
    entries = await readdir(absDir, { withFileTypes: true });
  } catch {
    return NextResponse.json({ error: "cannot read directory" }, { status: 403 });
  }

  const items: Array<{
    name: string;
    path: string;
    isDir: boolean;
    size?: number;
    modifiedAt?: string;
  }> = [];
  let truncated = false;

  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    if (items.length >= MAX_ENTRIES) {
      truncated = true;
      break;
    }
    const entryPath = relPath ? join(relPath, entry.name) : entry.name;
    const item: (typeof items)[number] = {
      name: entry.name,
      path: entryPath,
      isDir: entry.isDirectory(),
    };
    if (!entry.isDirectory()) {
      try {
        const s = await stat(join(absDir, entry.name));
        item.size = s.size;
        item.modifiedAt = s.mtime.toISOString();
      } catch {
        /* size unknown — skip */
      }
    }
    items.push(item);
  }

  // 排序:目录在前,后按名
  items.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return NextResponse.json({
    code: 200,
    message: "success",
    data: { items, truncated },
  });
}