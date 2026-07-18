import { NextResponse, type NextRequest } from "next/server";
import { readFile, stat } from "fs/promises";
import { join } from "path";
import { getRpcSession } from "@/lib/rpc-manager";
import { getSessionMeta } from "@/lib/session-meta";
import { assertCanReadSessionScoped } from "@/lib/team-auth";
import { getUserHighestRole } from "@/lib/user-role";
import { enforceNotMustChange } from "@/lib/must-change-password";
import { assertWithinRoot, PathTraversalError } from "@/lib/path-safety";

export const dynamic = "force-dynamic";

/**
 * GET /api/agent/[id]/files/[...path]
 *
 * 读 session 工作区内的单个文本文件。
 *
 * 安全:
 * - assertWithinRoot 防 ../ 与绝对路径(realpath 解析 symlink)
 * - 大小限制 1MB,超过返 413(不加载,防 OOM)
 * - 二进制检测:读前 512 字节,NUL 字节比例 > 30% → 415
 * - 必须是常规文件(不是 device / socket / pipe)
 *
 * 鉴权: 与列目录端点一致 — assertCanReadSessionScoped
 *
 * 响应: { code, data: { content, size, modifiedAt } }
 */

const MAX_TEXT_BYTES = 1024 * 1024; // 1 MB
const BINARY_PROBE_BYTES = 512;
const BINARY_NUL_RATIO = 0.3;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; path: string[] }> },
): Promise<NextResponse> {
  const gate = enforceNotMustChange(req);
  if (gate) return gate;

  const userId = req.headers.get("x-user-id");
  if (!userId) {
    return NextResponse.json({ error: "auth required" }, { status: 401 });
  }

  const { id: sessionId, path: pathSegments } = await params;

  if (!pathSegments || pathSegments.length === 0) {
    return NextResponse.json({ error: "path required" }, { status: 400 });
  }

  // 鉴权
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

  // 拿 cwd
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
      { error: "session has no working directory" },
      { status: 404 },
    );
  }

  // 拼路径 + 路径安全
  const relPath = pathSegments.join("/");
  let absFile: string;
  try {
    absFile = assertWithinRoot(relPath, cwd);
  } catch (e) {
    if (e instanceof PathTraversalError) {
      return NextResponse.json({ error: "path outside working directory" }, { status: 400 });
    }
    return NextResponse.json({ error: "invalid path" }, { status: 400 });
  }

  // stat 检查存在 + 类型
  let fileStat;
  try {
    fileStat = await stat(absFile);
  } catch {
    return NextResponse.json({ error: "file not found" }, { status: 404 });
  }
  if (!fileStat.isFile()) {
    return NextResponse.json({ error: "not a regular file" }, { status: 400 });
  }
  if (fileStat.size > MAX_TEXT_BYTES) {
    return NextResponse.json(
      { error: `file too large (${fileStat.size} bytes, max ${MAX_TEXT_BYTES})` },
      { status: 413 },
    );
  }

  // 二进制检测 — 读前 512 字节, NUL 比例 > 30% 视为二进制
  const fd = await import("fs/promises");
  const handle = await fd.open(absFile, "r");
  try {
    const probeLen = Math.min(BINARY_PROBE_BYTES, fileStat.size);
    const probeBuf = Buffer.alloc(probeLen);
    await handle.read(probeBuf, 0, probeLen, 0);
    let nulCount = 0;
    for (let i = 0; i < probeLen; i++) {
      if (probeBuf[i] === 0) nulCount++;
    }
    if (probeLen > 0 && nulCount / probeLen > BINARY_NUL_RATIO) {
      return NextResponse.json(
        { error: "binary file not previewable" },
        { status: 415 },
      );
    }
  } finally {
    await handle.close();
  }

  // 读全文(已经限 1MB)
  const content = await readFile(absFile, "utf8");

  return NextResponse.json({
    code: 200,
    message: "success",
    data: {
      content,
      size: fileStat.size,
      modifiedAt: fileStat.mtime.toISOString(),
    },
  });
}