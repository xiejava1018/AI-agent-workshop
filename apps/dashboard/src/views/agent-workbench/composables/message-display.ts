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

export function isEmptyThinkingBlock(block: AssistantContentBlock): boolean {
  return block.type === 'thinking' && !(block as { deferred?: boolean }).deferred && block.thinking.trim() === ''
}

export function getDisplayableBlocks(blocks: readonly AssistantContentBlock[]): AssistantContentBlock[] {
  return blocks.filter((b) => !isEmptyThinkingBlock(b))
}

function isFinalAnswerBlock(block: AssistantContentBlock): boolean {
  return block.type === 'text' || block.type === 'image'
}

export function splitFinalAssistantBlocks(
  blocks: readonly AssistantContentBlock[],
): { answerBlocks: AssistantContentBlock[]; processBlocks: AssistantContentBlock[] } {
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
    processBlocks: displayable.slice(0, lastProcessIndex + 1),
  }
}

export function countToolCallBlocks(blocks: readonly AssistantContentBlock[]): number {
  let n = 0
  for (const b of blocks) if (b.type === 'toolCall') n++
  return n
}
