/**
 * ChatWindow 折叠算法 helpers — mirror apps/web/components/ChatWindow.tsx 行为。
 *
 *   - hasFinalAssistantAnswer(msg):msg 是否携带 displayable 内容(text / image / toolCall)
 *   - isEmptyThinkingBlock(msg): 简化版 — 与 hasFinalAssistantAnswer 互补
 *   - processGroups(messages): 把连续 assistant 段折叠为 RenderItem 序列
 *
 * 决策(参考 OpenSpec design Decision 1, 2):
 *   - 单一层折叠,group 不嵌套
 *   - 最终回复(每段的最后一条 assistant)不进 group
 *   - 跨 user 边界:group 在 [lastUser+1, nextUser-1] 内寻找候选
 */

import type { AgentMessage } from '../types'
import type { AssistantContentBlock } from '../types/assistant-blocks'

/** RenderItem discriminated union.ChatWindow 模板基于 type 路由。 */
export type RenderItem =
  | { type: 'message'; message: AgentMessage; inProcessDetails: boolean }
  | { type: 'group'; messages: AgentMessage[] }

/**
 * msg 是否有 displayable 内容(text / image / toolCall)。user / system / tool 角色不计入。
 *   - role !== 'assistant' → false
 *   - content 是 string 且 trim 后非空 → true
 *   - content 是 array,至少 1 个 block.type !== 'thinking' → true
 *   - 否则 false(空 / 纯 thinking / 纯 image 但 block 形态不全算进去的补一个 true)
 */
export function hasFinalAssistantAnswer(msg: AgentMessage): boolean {
  if (msg.role !== 'assistant') return false
  const c = msg.content
  if (typeof c === 'string') {
    return c.trim().length > 0
  }
  if (Array.isArray(c)) {
    let hasNonThinking = false
    for (const block of c) {
      if (block.type !== 'thinking') {
        hasNonThinking = true
        break
      }
    }
    // array 形态但只有 thinking → false;含 text/image/toolCall → true
    return c.length > 0 && hasNonThinking
  }
  return false
}

/** 简化版:是否"空 / 纯 thinking" — 与 hasFinalAssistantAnswer 互补。 */
export function isEmptyThinkingBlock(msg: AgentMessage): boolean {
  return !hasFinalAssistantAnswer(msg)
}

/** 累加 assistant 内容里的 toolCall block 数(snapshot 兼容:含 toolCalls 字段也算) */
function countToolCallsInMsg(msg: AgentMessage): number {
  if (msg.role !== 'assistant') return 0
  const c = msg.content
  if (Array.isArray(c)) {
    let n = 0
    for (const block of c as AssistantContentBlock[]) {
      if (block.type === 'toolCall') n++
    }
    return n
  }
  return msg.toolCalls ? msg.toolCalls.length : 0
}

/** Public:消息组内 toolCall block 总数(供 ProcessDetailsGroup header 使用 — 这里 helper 留作 future test)。 */
export function countToolCallsInGroup(messages: readonly AgentMessage[]): number {
  let n = 0
  for (const m of messages) n += countToolCallsInMsg(m)
  return n
}

/**
 * 把单条 assistant message 按 block 拆开成多条虚拟 message(仅在 content 是 array 形态时)。
 * 用于在一条 assistant message 同时含多 block 时也能触发折叠。
 *
 * 拆解策略:
 *   - thinking + toolCall 类型的 block → 拆出独立虚拟 message(role=assistant, content: [{type:block}])
 *   - text 类型 block → 注入相邻 content message 形成单 assistant 的"完整内容"
 *   - image 类型 block → 独立虚拟 message
 *
 * 返回原 message(若无需拆解)+ 拆出的虚拟 message 列表(用于 processGroups 折叠)。
 *
 * 触发条件(单条 assistant message content 是 array ≥ 3 blocks):
 *   - cnt(blocks) ≥ 3
 *   - cnt(blocks where type !== 'thinking') ≥ 1 (有 text / toolCall / image 显示性)
 */
export function splitAssistantMessageByBlocks(msg: AgentMessage): AgentMessage[] {
  if (msg.role !== 'assistant') return [msg]
  const c = msg.content
  if (!Array.isArray(c)) return [msg]
  if (c.length < 3) return [msg]
  // 算 displayable 数量
  let displayable = 0
  for (const b of c) {
    if (b.type !== 'thinking') displayable++
  }
  if (displayable < 1) return [msg]

  // 拆:每个 block 独立成虚拟 message,共享同一原始 id + 创建时间
  const baseProps = {
    id: msg.id,
    role: 'assistant' as const,
    createdAt: msg.createdAt,
    modelProvider: msg.modelProvider,
    modelId: msg.modelId,
    entryId: msg.entryId,
    prevAssistantEntryId: msg.prevAssistantEntryId,
  }
  // 拆是 n 条相同 id 会让 v-for key 冲突 → 给每条加 suffix
  const out: AgentMessage[] = []
  for (let i = 0; i < c.length; i++) {
    const block = c[i]!
    out.push({
      ...baseProps,
      id: `${msg.id}__block-${i}`,
      content: [block] as AssistantContentBlock[],
    })
  }
  return out
}

/**
 * 按 block 拆解所有 assistant messages,然后调用 processGroups。
 * 一个 message ≥ 3 blocks 的 special case 触发 ProcessDetailsGroup。
 */
export function processMessagesForDisplay(messages: readonly AgentMessage[]): RenderItem[] {
  // Step 1: 把多 block 的 assistant messages 展开为多条虚拟 messages
  const expanded: AgentMessage[] = []
  for (const m of messages) {
    const splitted = splitAssistantMessageByBlocks(m)
    for (const s of splitted) expanded.push(s)
  }
  // Step 2: 跑 processGroups
  return processGroups(expanded)
}

/**
 * 扫描 messages,寻找可折叠的连续 assistant 序列。
 * Trigger:
 *   - segment.length ≥ 3 consecutive assistant
 *   - 至少 1 条 hasFinalAssistantAnswer(msg) === true (displayable)
 *
 * 折叠策略(≥3 才折叠):
 *   - last hasFinalAssistantAnswer → 倒数 N-1 条 (≥2 才进 group) + 最后一条 flat 作为 final reply
 *     例: [a1, a2, a3]   len=3; [a1, a2] len=2 ≥ 2 → group; a3 flat ✓
 *         [a1, a2]         len=2 → trigger 不满足(<3), 全 flat
 *   - last isEmptyThinkingBlock → 全部进 group
 *
 * 简化版:实际工程里 findFinalAssistantIndex 与 hasFinalAssistantAnswer 是分开算的,
 * 这里我把两者合一。语义对齐 apps/web:hasFinalAssistantAnswer 在 React 版
 * 决定"是否 tool 调用结果足够长到变成完整 final"。
 */
export function processGroups(messages: readonly AgentMessage[]): RenderItem[] {
  const out: RenderItem[] = []
  let i = 0
  const n = messages.length
  while (i < n) {
    const m = messages[i]
    if (m.role !== 'assistant') {
      out.push({ type: 'message', message: m, inProcessDetails: false })
      i += 1
      continue
    }

    // 收集从此处开始向后连续的 assistant,直到 user 或末尾
    let j = i
    while (j < n && messages[j].role === 'assistant') j++
    const segment = messages.slice(i, j)

    // ≥1 条 displayable
    const displayableCount = segment.reduce(
      (acc, a) => acc + (hasFinalAssistantAnswer(a) ? 1 : 0),
      0,
    )

    // Trigger: ≥3 + ≥1 displayable 才折叠
    if (segment.length >= 3 && displayableCount >= 1) {
      const last = segment[segment.length - 1]!
      if (hasFinalAssistantAnswer(last)) {
        const groupMsgs = segment.slice(0, -1)
        // groupMsgs.length 此时 ≥ 2(因 segment.length ≥ 3)
        out.push({ type: 'group', messages: groupMsgs })
        out.push({ type: 'message', message: last, inProcessDetails: false })
      } else {
        // 最后一条 thinking(空)→ 全进 group
        out.push({ type: 'group', messages: segment })
      }
    } else {
      // 不满足 trigger,segment 内所有 assistant 平铺
      for (const a of segment) {
        out.push({ type: 'message', message: a, inProcessDetails: false })
      }
    }
    i = j
  }
  return out
}
