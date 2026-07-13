declare global {
  var __piSessionMeta: Map<string, SessionMetaRow> | undefined;
}

export type SessionMetaRow = {
  userId: string | null;
  projectId: string | null;
  createdAt: number;
};

function getMetaMap(): Map<string, SessionMetaRow> {
  if (!globalThis.__piSessionMeta) {
    globalThis.__piSessionMeta = new Map();
    rebuildFromJsonl(globalThis.__piSessionMeta);
  }
  return globalThis.__piSessionMeta;
}

async function rebuildFromJsonl(_map: Map<string, SessionMetaRow>): Promise<void> {
  // M1: no-op（fork 的 .jsonl 重启时本身就是空 meta, 标 userId=null 重启）
  // 后续可扫描 <PI_WEB_DATA_DIR>/**/*.jsonl 第一行元数据
}

export function recordSessionMeta(
  realSessionId: string,
  userId: string | null,
  projectId: string | null
) {
  const map = getMetaMap();
  if (!map.has(realSessionId)) {
    map.set(realSessionId, { userId, projectId, createdAt: Date.now() });
  }
}

export function getSessionMeta(realSessionId: string): SessionMetaRow | undefined {
  return getMetaMap().get(realSessionId);
}

export function listSessionMeta(): SessionMetaRow[] {
  return Array.from(getMetaMap().values());
}

export function assertCanReadSession(
  userId: string,
  userRole: "OWNER" | "ADMIN" | "MEMBER" | null,
  sessionId: string
): boolean {
  const meta = getSessionMeta(sessionId);
  if (!meta) return false;
  if (meta.userId === userId) return true;
  if (userRole && ["OWNER", "ADMIN"].includes(userRole)) {
    // 注: M1 简化, 不做 teamId 检查（owner/admin 总可见）
    return true;
  }
  return false;
}
