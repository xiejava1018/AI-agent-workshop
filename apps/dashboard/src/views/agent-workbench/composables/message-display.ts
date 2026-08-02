/**
 * message-display — port 自 apps/web/lib/message-display.ts。
 *
 * splitFinalAssistantBlocks:把单条 assistant message 的 content blocks 拆成
 *   - processBlocks(thinking / toolCall)→ 进 ProcessDetailsGroup 折叠
 *   - answerBlocks(最后的连续 text / image)→ 独立渲染(用户的最终回复)
 *
 * 规则:找最后一个"非 answer" block(thinking/toolCall)的 index,
 * 它及之前 = processBlocks,之后 = answerBlocks。
 */
import type { AssistantContentBlock } from '../types/assistant-blocks'
import type { AgentMessage } from '../types'

/** AssistantMessage —— AgentMessage 中 role === 'assistant' 的子类型。
 *  types.ts 未导出该类型(保持类型单一源),这里 inline 定义。 */
type AssistantMessage = AgentMessage & { role: 'assistant' }

export function isEmptyThinkingBlock(block: AssistantContentBlock): boolean {
  return (
    block.type === 'thinking' &&
    !(block as { deferred?: boolean }).deferred &&
    block.thinking.trim() === ''
  )
}

export function getDisplayableBlocks(
  blocks: readonly AssistantContentBlock[]
): AssistantContentBlock[] {
  return blocks.filter((b) => !isEmptyThinkingBlock(b))
}

function isFinalAnswerBlock(block: AssistantContentBlock): boolean {
  return block.type === 'text' || block.type === 'image'
}

export function splitFinalAssistantBlocks(blocks: readonly AssistantContentBlock[]): {
  answerBlocks: AssistantContentBlock[]
  processBlocks: AssistantContentBlock[]
} {
  const displayable = getDisplayableBlocks(blocks)
  // findLastIndex
  let lastProcessIndex = -1
  for (let i = displayable.length - 1; i >= 0; i--) {
    if (!isFinalAnswerBlock(displayable[i]!)) {
      lastProcessIndex = i
      break
    }
  }
  if (lastProcessIndex === -1) {
    return { answerBlocks: displayable, processBlocks: [] }
  }
  return {
    answerBlocks: displayable.slice(lastProcessIndex + 1),
    processBlocks: displayable.slice(0, lastProcessIndex + 1)
  }
}

export function countToolCallBlocks(blocks: readonly AssistantContentBlock[]): number {
  let n = 0
  for (const b of blocks) if (b.type === 'toolCall') n++
  return n
}

// ============================================================================
// Turn-grouping(回合聚合)—— port 自 apps/web/components/ChatWindow.tsx
//
// 目标:把消息流按 "user → finalAssistant" 切分成回合,中间的过程消息
// (thinking/toolCall)与 finalAssistant 的 processBlocks 一起折叠到
// <ProcessDetailsGroup>,finalAssistant 的 answerBlocks 单独渲染。
//
// 这让"3 messages · 3 tool calls"这种汇总计数有意义(原本按单消息聚合
// 永远是"1 message · N tool calls",用户看不到回合整体进度)。
// ============================================================================

/** assistant message 是否有"最终回答"(非空 text 或 image)—— port hasFinalAssistantAnswer */
export function hasFinalAssistantAnswer(message: AgentMessage): boolean {
  if (message.role !== 'assistant') return false
  const blocks = (message as AssistantMessage).content
  // 流式阶段 content 是 string,这种情况视为有“回答”(进行中的 text 也算)
  if (typeof blocks === 'string') return blocks.trim().length > 0
  if (!Array.isArray(blocks)) return false
  const split = splitFinalAssistantBlocks(blocks as AssistantContentBlock[])
  return split.answerBlocks.some(
    (b) => b.type === 'image' || (b.type === 'text' && b.text.trim().length > 0)
  )
}

/** 找 [userIdx+1, endIdx) 区间内的"最终助手"位置 —— port findFinalAssistantIndex */
export function findFinalAssistantIndex(
  messages: readonly AgentMessage[],
  userIdx: number,
  endIdx: number
): number {
  for (let i = endIdx - 1; i > userIdx; i--) {
    if (hasFinalAssistantAnswer(messages[i]!)) return i
  }
  for (let i = endIdx - 1; i > userIdx; i--) {
    if (messages[i]?.role === 'assistant') return i
  }
  return -1
}

/** 判断一条 assistant 消息有没有"显示用"的 blocks —— port getDisplayableAssistantBlocks.length > 0 */
export function hasDisplayableProcessBlocks(message: AgentMessage): boolean {
  if (message.role !== 'assistant') return false
  const blocks = (message as AssistantMessage).content
  if (!Array.isArray(blocks)) return false
  // 流式阶段 content 为 string(不是 array),上面已过滤;再 extra-safe 一次
  return getDisplayableBlocks(blocks as AssistantContentBlock[]).length > 0
}

/** 数 process 区间里 assistant 消息的 toolCall 数 —— port countToolCalls */
export function countToolCallsInIndices(
  messages: readonly AgentMessage[],
  indices: readonly number[]
): number {
  let n = 0
  for (const idx of indices) {
    const m = messages[idx]
    if (!m || m.role !== 'assistant') continue
    const blocks = (m as AssistantMessage).content
    if (!Array.isArray(blocks)) continue
    n += countToolCallBlocks(getDisplayableBlocks(blocks as AssistantContentBlock[]))
  }
  return n
}

export interface TurnProcessGroup {
  /** 区间内 process 候选索引(已被 hasDisplayableProcessBlocks 过滤) */
  processIndices: number[]
  /** finalAssistantIdx(在 messages 数组中的位置) */
  finalAssistantIdx: number
  /** processBlocks(从 finalAssistant.content 拆分) */
  finalProcessBlocks: AssistantContentBlock[]
  /** answerBlocks(从 finalAssistant.content 拆分) */
  finalAnswerBlocks: AssistantContentBlock[]
}

/**
 * 给定 [userIdx, endIdx) 区间,返回回合的 process group 结构。
 * 若没有 finalAssistant,返回 null。
 */
export function buildTurnProcessGroup(
  messages: readonly AgentMessage[],
  userIdx: number,
  endIdx: number
): TurnProcessGroup | null {
  const finalAssistantIdx = findFinalAssistantIndex(messages, userIdx, endIdx)
  if (finalAssistantIdx === -1) return null
  const finalAssistant = messages[finalAssistantIdx] as AssistantMessage
  const rawFinalBlocks = finalAssistant.content
  const finalBlocks: AssistantContentBlock[] = Array.isArray(rawFinalBlocks)
    ? (rawFinalBlocks as AssistantContentBlock[])
    : []
  const split = splitFinalAssistantBlocks(finalBlocks)
  const processIndices: number[] = []
  for (let i = userIdx + 1; i < finalAssistantIdx; i++) {
    if (hasDisplayableProcessBlocks(messages[i]!)) processIndices.push(i)
  }
  return {
    processIndices,
    finalAssistantIdx,
    finalProcessBlocks: split.processBlocks,
    finalAnswerBlocks: split.answerBlocks
  }
}

/**
 * 把 assistant message 的 content 替换为指定 blocks(用于回合聚合里把
 * finalAssistant.content 拆成 process 部分和 answer 部分分别渲染)。
 * port withAssistantBlocks。
 */
export function withAssistantBlocks(
  message: AssistantMessage,
  content: AssistantContentBlock[],
  options: { omitUsage?: boolean } = {}
): AssistantMessage {
  const next = { ...message, content }
  if (options.omitUsage) next.usage = undefined
  return next
}

/**
 * 顶部入口:把消息流拆成"渲染片段"。
 * 片段有两种:
 *   - { kind: 'message', message, key }:单条消息(user 或降级 assistant)
 *   - { kind: 'turn', user, processGroup, key }:一个 user→finalAssistant 回合
 * 流式尾巴(agentRunning + 最后一个回合)直接当 message 渲染,不聚合。
 */
export type RenderSegment =
  | { kind: 'message'; message: AgentMessage; key: string }
  | {
      kind: 'turn'
      user: AgentMessage
      processGroup: TurnProcessGroup
      key: string
      /** processGroup 内的 process messages(完整 AgentMessage,渲染时 content
       *  取自原始 message.content 的全量 blocks) */
      processMessages: AgentMessage[]
    }

export function buildRenderSegments(
  messages: readonly AgentMessage[],
  options: { isLiveTail: boolean } = { isLiveTail: false }
): RenderSegment[] {
  // 对齐 apps/web:visibleMessages = messages.filter(m => m.role === 'user' || m.role === 'assistant')。
  // tool / toolResult role message 不独立渲染——其结果通过 pairedResultsByToolCallId Map
  // 注入到对应 assistant toolCall block 内。
  const visibleMessages = messages.filter(
    (m) => m.role === 'user' || m.role === 'assistant'
  )
  const out: RenderSegment[] = []
  let idx = 0
  while (idx < visibleMessages.length) {
    const m = visibleMessages[idx]!
    if (m.role !== 'user') {
      out.push({ kind: 'message', message: m, key: `m-${m.id}` })
      idx += 1
      continue
    }
    const userIdx = idx
    let endIdx = userIdx + 1
    while (endIdx < visibleMessages.length && visibleMessages[endIdx]!.role !== 'user') endIdx += 1

    const isLastRound = endIdx === visibleMessages.length && userIdx === visibleMessages.lastIndexOf(m)
    const group = buildTurnProcessGroup(visibleMessages, userIdx, endIdx)

    // 流式尾巴:不聚合,全部当 message 渲染
    if (options.isLiveTail && isLastRound) {
      for (let i = userIdx; i < endIdx; i++) {
        out.push({ kind: 'message', message: visibleMessages[i]!, key: `m-${visibleMessages[i]!.id}` })
      }
      idx = endIdx
      continue
    }

    if (!group || (group.processIndices.length === 0 && group.finalProcessBlocks.length === 0)) {
      // 没 process group,或 process group 是空的(整个回合没有 thinking/toolCall)→
      // 按 user + 每条 message 顺序渲染,不聚合
      for (let i = userIdx; i < endIdx; i++) {
        out.push({ kind: 'message', message: visibleMessages[i]!, key: `m-${visibleMessages[i]!.id}` })
      }
      idx = endIdx
      continue
    }

    const processMessages: AgentMessage[] = []
    for (const pi of group.processIndices) processMessages.push(visibleMessages[pi]!)

    out.push({
      kind: 'turn',
      user: m,
      processGroup: group,
      key: `turn-${userIdx}-${group.finalAssistantIdx}`,
      processMessages
    })
    idx = endIdx
  }
  return out
}
