/**
 * useTabTitles —— tab title 显示策略(抽离以便单测)。
 *
 * 优先级:
 *   1) 后端返回的 session.title(默认 '新会话')→
 *      - title 为非默认(不是 '新会话',不是 raw id)→ 用 backend title(已通过
 *        rename / auto-rename 更新过)
 *      - title === '新会话' → 表示用户尚未发过消息或后端尚未重命名,tab 也显示
 *        '新会话'(友好)
 *   2) 后端列表尚未拉到的乐观会话:fallback '会话 {sessionId 前 6 位}'
 *      作为唯一性提示。避免新会话 tab 与旧 '新会话' tab 分不清。
 *
 * 为什么不直接读 sessionId 前 8 位当作默认 tab title:
 *   - 后端 title 已经存在并更友好(用户已发过消息或重命名过)。
 *   - '会话 019f9967' 这种 hash 前缀对用户无意义,不应作为首选。
 *   - 兜底仅在乐观会话(尚未拉到后端)时使用,以避免 N 个 tab 都是 '新会话'。
 */
import type { AgentSession } from '@/api/agent'

/**
 * 纯函数:给定 sessions 列表 + sessionId,返回 tab 友好 title。
 *
 * 抽出为纯函数以便在测试中不需要挂载 Vue 组件。
 */
export function resolveTabTitle(
  sessionId: string,
  sessions: ReadonlyArray<AgentSession>
): string {
  const fromList = sessions.find((s) => s.id === sessionId)
  const backendTitle = fromList?.title?.trim()
  // 后端返回了真实命名(已重命名 / auto-rename 完) → 用它
  if (backendTitle && backendTitle !== '新会话' && backendTitle !== sessionId) {
    return backendTitle
  }
  // 后端返回的默认 '新会话' → 用户可见但无价值,仍显示该词。
  // (多 tab 时如果想要区分,可加上 ' (id 前缀)' — v1 先不区分)
  if (backendTitle === '新会话') return '新会话'
  // 后端未拉到 → 兜底 '会话 {id 前缀}' 作为唯一性提示
  return `会话 ${sessionId.slice(0, 6)}`
}