/**
 * Local mirror of apps/web/lib/types.ts — this is not a re-export.
 * Last synced: 2026-07-22.
 * Verify field shapes if apps/web/lib/types.ts has changes — this drift is intentional and tracked in design.md R1.
 */

/** Represents an assistant text block. */
export interface TextContent {
  type: 'text'
  text: string
}

/** Represents an assistant image block and its encoded or remote source. */
export interface ImageContent {
  type: 'image'
  source: {
    type: 'base64' | 'url'
    media_type?: string
    data?: string
    url?: string
  }
}

/** Represents an assistant reasoning block, optionally deferred for on-demand loading. */
export interface ThinkingContent {
  type: 'thinking'
  thinking: string
  deferred?: boolean
}

/** Represents a tool invocation emitted by the assistant. */
export interface ToolCallContent {
  type: 'toolCall'
  toolCallId: string
  toolName: string
  input: Record<string, unknown>
}

/** Represents any content block emitted in an assistant message. */
export type AssistantContentBlock = TextContent | ThinkingContent | ToolCallContent | ImageContent
