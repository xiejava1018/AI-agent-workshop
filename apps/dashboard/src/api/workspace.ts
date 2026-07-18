import request from '@/utils/http'

export function getWorkspaceStats() {
  return request.get<any>({
    url: '/api/dashboard/stats'
  })
}

/**
 * Recent sessions for the workspace table. /api/sessions returns
 * { sessions: SessionInfo[], runningSessionIds: string[] }; the view only
 * needs the array, so extract and slice here to keep the view simple.
 */
export async function getRecentSessions(limit = 10) {
  const res = await request.get<{ sessions: any[]; runningSessionIds: string[] }>({
    url: '/api/sessions'
  })
  const sessions = res?.sessions ?? []
  return sessions.slice(0, limit)
}
