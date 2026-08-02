/**
 * T2.6 — normalizeContent + normalizeContentBlocks 单测。
 *
 * 覆盖 G2 SSE 归一化 4 形态 + T2.3 SDK→mirror 转换 4 形态。
 * 配套 useEventStream.test.ts 已修 message_end 后 content 是 [{type:'text', text:'...'}] 形态。
 *
 * Spec: openspec/changes/blockview-tree-rendering/specs/assistant-message-blockview/spec.md
 *       "SSE 入口归一化" scenarios。
 *
 * 输入 fixture 在测试体里直构造,纯函数 import 真实路径。
 */
import { describe, expect, it } from 'vitest'
import {
  normalizeContent,
  normalizeContentBlocks
} from './useEventStream'
import type {
  AssistantContentBlock,
  ImageContent,
  TextContent,
  ThinkingContent,
  ToolCallContent
} from '../types/assistant-blocks'

describe('normalizeContent', () => {
  // (a) null / undefined → []
  it('returns empty array when raw is null', () => {
    expect(normalizeContent(null)).toEqual([])
  })

  it('returns empty array when raw is undefined', () => {
    expect(normalizeContent(undefined)).toEqual([])
  })

  // (b) string → [{type:'text', text:string}]
  it('wraps a plain string into a single text block', () => {
    const out = normalizeContent('hello')
    expect(out).toEqual<TextContent[]>([{ type: 'text', text: 'hello' }])
  })

  it('wraps an empty string into a single empty text block (preserves the slot)', () => {
    const out = normalizeContent('')
    expect(out).toEqual<TextContent[]>([{ type: 'text', text: '' }])
  })

  // (c) single block object → [block]
  it('wraps a single block object into a one-element array (reference preserved)', () => {
    const block: TextContent = { type: 'text', text: 'x' }
    const out = normalizeContent(block)
    expect(out).toHaveLength(1)
    expect(out[0]).toBe(block) // identity preserved — no allocation
  })

  // (d) array → array (filter nullish entries)
  it('keeps array elements by reference and drops nullish entries', () => {
    const text: TextContent = { type: 'text', text: 'a' }
    const think: ThinkingContent = { type: 'thinking', thinking: 'b' }
    const input: ReadonlyArray<AssistantContentBlock | null | undefined> = [
      text,
      null,
      think,
      undefined
    ]
    const out = normalizeContent(input)
    expect(out).toEqual<AssistantContentBlock[]>([text, think])
    // identity preserved for surviving elements
    expect(out[0]).toBe(text)
    expect(out[1]).toBe(think)
  })

  it('returns empty array for an empty array input', () => {
    expect(normalizeContent([])).toEqual([])
  })

  // primitive fallback — number / boolean don't map to a block shape
  it('returns empty array for a number primitive', () => {
    expect(normalizeContent(42)).toEqual([])
  })

  it('returns empty array for a boolean primitive', () => {
    expect(normalizeContent(true)).toEqual([])
  })

  // idempotency — same input deep-equals after re-running
  it('is idempotent for representative inputs (string / array / null / undefined / primitives)', () => {
    const inputs: ReadonlyArray<unknown> = [
      null,
      undefined,
      'hello',
      '',
      { type: 'text', text: 'x' },
      [
        { type: 'text', text: 'a' },
        { type: 'thinking', thinking: 'b' },
        null
      ],
      [],
      42,
      true
    ]
    for (const raw of inputs) {
      const once = normalizeContent(raw)
      const twice = normalizeContent(once)
      expect(twice).toEqual(once)
    }
  })
})

describe('normalizeContentBlocks', () => {
  // toolCall: SDK → mirror rename (SDK fields remain alongside; spec 要求"对未识别的 toolCall 字段不做丢弃")
  it('renames SDK toolCall wire fields {id, name, arguments} to mirror {toolCallId, toolName, input} (SDK fields retained)', () => {
    const sdkBlock = {
      type: 'toolCall',
      id: 'abc',
      name: 'bash',
      arguments: { command: 'echo hi' }
    } as unknown as ToolCallContent

    const out = normalizeContentBlocks([sdkBlock])
    expect(out).toHaveLength(1)
    const result = out[0] as ToolCallContent & { id?: string; name?: string; arguments?: Record<string, unknown> }
    expect(result.type).toBe('toolCall')
    expect(result.toolCallId).toBe('abc')
    expect(result.toolName).toBe('bash')
    expect(result.input).toEqual({ command: 'echo hi' })
    // SDK wire fields are not dropped on the rename layer
    expect(result.id).toBe('abc')
    expect(result.name).toBe('bash')
    expect(result.arguments).toEqual({ command: 'echo hi' })
  })

  // toolCall: mirror passthrough (no SDK fields present)
  it('passes through mirror toolCall blocks unchanged when only mirror fields are set', () => {
    const mirrorBlock: ToolCallContent = {
      type: 'toolCall',
      toolCallId: 'abc',
      toolName: 'bash',
      input: { command: 'echo hi' }
    }
    const out = normalizeContentBlocks([mirrorBlock])
    expect(out).toHaveLength(1)
    expect(out[0]).toEqual(mirrorBlock)
  })

  // toolCall: mirror wins when both shapes are present (defensive fallback)
  it('keeps mirror fields when both SDK and mirror fields are present on the same block', () => {
    const hybrid = {
      type: 'toolCall',
      id: 'sdk-id',
      toolCallId: 'mirror-id',
      name: 'sdk-name',
      toolName: 'mirror-name',
      arguments: { sdk: true },
      input: { mirror: true }
    } as unknown as ToolCallContent

    const out = normalizeContentBlocks([hybrid])
    expect(out).toHaveLength(1)
    const result = out[0] as ToolCallContent & {
      id?: string
      name?: string
      arguments?: Record<string, unknown>
    }
    expect(result.type).toBe('toolCall')
    expect(result.toolCallId).toBe('mirror-id')
    expect(result.toolName).toBe('mirror-name')
    expect(result.input).toEqual({ mirror: true })
    // SDK wire fields are still present alongside (spec: 不丢弃未识别字段)
    expect(result.id).toBe('sdk-id')
    expect(result.name).toBe('sdk-name')
    expect(result.arguments).toEqual({ sdk: true })
  })

  // toolCall: extra unknown fields preserved through spread
  it('preserves unknown fields on toolCall blocks (e.g. thoughtSignature)', () => {
    const withExtra = {
      type: 'toolCall',
      id: 'abc',
      name: 'bash',
      arguments: { command: 'echo hi' },
      thoughtSignature: 'opaque-token'
    } as unknown as ToolCallContent

    const out = normalizeContentBlocks([withExtra])
    expect(out).toHaveLength(1)
    const result = out[0] as ToolCallContent & { thoughtSignature?: string }
    expect(result.toolCallId).toBe('abc')
    expect(result.toolName).toBe('bash')
    expect(result.input).toEqual({ command: 'echo hi' })
    expect(result.thoughtSignature).toBe('opaque-token')
  })

  // image: SDK flat → mirror nested
  it('converts SDK flat image {data, mimeType} into mirror nested source {type:base64, media_type, data}', () => {
    const flatImage = {
      type: 'image',
      data: 'iVBORw',
      mimeType: 'image/png'
    } as unknown as ImageContent

    const out = normalizeContentBlocks([flatImage])
    expect(out).toHaveLength(1)
    expect(out[0]).toEqual<ImageContent>({
      type: 'image',
      source: {
        type: 'base64',
        media_type: 'image/png',
        data: 'iVBORw'
      }
    })
  })

  // image: mirror nested URL passes through
  it('passes through mirror nested URL image blocks unchanged', () => {
    const urlImage: ImageContent = {
      type: 'image',
      source: {
        type: 'url',
        url: 'https://cdn.example.com/x.png'
      }
    }
    const out = normalizeContentBlocks([urlImage])
    expect(out).toHaveLength(1)
    expect(out[0]).toEqual(urlImage)
  })

  // image: mirror nested base64 passes through
  it('passes through mirror nested base64 image blocks unchanged', () => {
    const base64Image: ImageContent = {
      type: 'image',
      source: {
        type: 'base64',
        media_type: 'image/png',
        data: 'iVBORw'
      }
    }
    const out = normalizeContentBlocks([base64Image])
    expect(out).toHaveLength(1)
    expect(out[0]).toEqual(base64Image)
  })

  // image: hybrid — block has both flat and nested, falls through unchanged (source authoritative when reading downstream)
  it('does not overwrite block when both flat and nested source fields are present', () => {
    const hybrid = {
      type: 'image',
      data: 'flat-data',
      mimeType: 'image/png',
      source: { type: 'base64', media_type: 'image/png', data: 'mirror-data' }
    } as unknown as ImageContent

    const out = normalizeContentBlocks([hybrid])
    expect(out).toHaveLength(1)
    // Block returned by reference (no copy); flat fields stay alongside mirror source
    expect(out[0]).toBe(hybrid)
    // Downstream reads `source` — mirror shape wins
    const img = out[0] as ImageContent
    expect(img.source).toEqual({ type: 'base64', media_type: 'image/png', data: 'mirror-data' })
  })

  // text: passthrough
  it('passes through text blocks unchanged (no copy)', () => {
    const text: TextContent = { type: 'text', text: 'hi' }
    const out = normalizeContentBlocks([text])
    expect(out).toHaveLength(1)
    expect(out[0]).toBe(text)
  })

  // thinking: passthrough
  it('passes through thinking blocks unchanged (no copy)', () => {
    const think: ThinkingContent = { type: 'thinking', thinking: 'r' }
    const out = normalizeContentBlocks([think])
    expect(out).toHaveLength(1)
    expect(out[0]).toBe(think)
  })
})