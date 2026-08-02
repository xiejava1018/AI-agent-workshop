/**
 * fetchSessionMessages 单测 —— Bug 回归:历史拉取的响应形状。
 *
 * 背景:`/api/sessions/[id]` 是 Next.js 路由,响应体形如
 *   { sessionId, filePath, info, leafId, tree, context: { messages, entryIds, ... } }
 * —— `context` 在顶层,没有被 `{ code, message, data }` 再包一层(那是 Vue 侧
 * `/api/agent/*` 代理路由的形状,如 listSessions 才走 `.data`)。
 *
 * 而 `httpClient`(utils/http/index.ts makeRequest)已把 AxiosResponse.data
 * 展平成响应体本身,所以 `fetchSessionMessages` 里要读 `res.context`,而不是
 * `res.data.context`。历史上误抄了代理路由的 `.data` 形状,导致 `ctx` 恒为
 * undefined、历史永远为空、Agent 工作台一直显示"开始对话"。
 *
 * 本测试直接 mock `@/utils/http`,以真实顶层 `context` 形状喂给
 * `fetchSessionMessages`,锁死这条契约。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/utils/http', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    del: vi.fn(),
    request: vi.fn()
  }
}))

import request from '@/utils/http'
import { fetchSessionMessages } from '@/api/agent'

const httpGet = vi.mocked(request.get)

describe('fetchSessionMessages — /api/sessions/[id] 顶层 context 形状(Bug 回归)', () => {
  beforeEach(() => {
    httpGet.mockReset()
  })

  it('从顶层 context.messages 解析历史(而非 res.data.context)', async () => {
    // 真实 Next.js 路由响应体形状:context 在顶层
    httpGet.mockResolvedValue({
      sessionId: '019f7a90-58b0-7ca7-81db-1af38c150ad0',
      filePath: '/home/u/pi/agent/sessions/xxx.jsonl',
      info: null,
      leafId: 'leaf-1',
      tree: [],
      context: {
        messages: [
          {
            role: 'user',
            content: [{ type: 'text', text: '今天天气怎么样?' }],
            timestamp: 1752900000000
          },
          {
            role: 'assistant',
            content: [{ type: 'text', text: '我无法查询实时天气。' }],
            timestamp: 1752900001000
          }
        ],
        entryIds: ['entry-u1', 'entry-a1']
      }
    })

    const res = await fetchSessionMessages('019f7a90-58b0-7ca7-81db-1af38c150ad0')
    const msgs = (
      res as {
        data: { messages: Array<{ id: string; role: string; content: string }> }
      }
    ).data.messages

    // 关键断言:旧实现读 res.data.context 会拿到 undefined,messages 为空
    expect(msgs).toHaveLength(2)
    expect(msgs[0].role).toBe('user')
    // user role:content 拍扁为 string(下游 MarkdownBody / minimap 等仍走 string 路径)
    expect(msgs[0].content).toBe('今天天气怎么样?')
    expect(msgs[0].id).toBe('entry-u1') // entryIds[i] 优先作稳定 id
    expect(msgs[1].role).toBe('assistant')
    // A 回合聚合:assistant role 保留 AssistantContentBlock[] 结构,
    // 供 ProcessDetailsGroup / turn-grouping 识别 process blocks
    expect(Array.isArray(msgs[1].content)).toBe(true)
    const a1Blocks = msgs[1].content as unknown as Array<{ type?: string; text?: string }>
    expect(a1Blocks[0]).toMatchObject({
      type: 'text',
      text: '我无法查询实时天气。'
    })
    expect(msgs[1].id).toBe('entry-a1')
  })

  it('content 为字符串时直接透传', async () => {
    httpGet.mockResolvedValue({
      sessionId: 's1',
      context: {
        messages: [{ role: 'user', content: 'hi', timestamp: 1752900000000 }],
        entryIds: ['e1']
      }
    })

    const res = await fetchSessionMessages('s1')
    const msgs = (res as { data: { messages: Array<{ content: string }> } }).data.messages

    expect(msgs[0].content).toBe('hi')
  })

  it('context 缺失时返回空历史而非抛错', async () => {
    httpGet.mockResolvedValue({ sessionId: 's1' }) // 无 context 字段

    const res = await fetchSessionMessages('s1')
    const msgs = (res as { data: { messages: unknown[] } }).data.messages

    expect(msgs).toEqual([])
    expect((res as { data: { total: number } }).data.total).toBe(0)
  })

  it('assistant message 透传 model/provider/usage(toolbar/footer 渲染依据)', async () => {
    httpGet.mockResolvedValue({
      sessionId: 's1',
      context: {
        messages: [
          {
            role: 'assistant',
            model: 'MiniMax-M3',
            provider: 'miniMAX-provider',
            usage: { input: 117, output: 71, cacheRead: 9271, cacheWrite: 0 },
            content: [{ type: 'text', text: 'reply' }],
            timestamp: 1
          }
        ]
      }
    })

    const res = await fetchSessionMessages('s1')
    const m = (res as { data: { messages: Array<{ modelId?: string; modelProvider?: string; usage?: unknown }> } }).data.messages[0]!
    expect(m.modelId).toBe('MiniMax-M3')
    expect(m.modelProvider).toBe('miniMAX-provider')
    expect(m.usage).toEqual({ input: 117, output: 71, cacheRead: 9271, cacheWrite: 0 })
  })

  it('toolResult message 透传 toolCallId/isError/toolName(ToolCallBlock 配对依据)', async () => {
    httpGet.mockResolvedValue({
      sessionId: 's1',
      context: {
        messages: [
          {
            role: 'assistant',
            content: [{ type: 'toolCall', toolCallId: 'call_1', toolName: 'bash', input: { command: 'ls' } }],
            timestamp: 1
          },
          {
            role: 'toolResult',
            toolCallId: 'call_1',
            toolName: 'bash',
            isError: false,
            content: [{ type: 'text', text: 'result output' }],
            timestamp: 2
          }
        ]
      }
    })

    const res = await fetchSessionMessages('s1')
    const msgs = (res as { data: { messages: Array<{ role: string; toolCallId?: string; toolIsError?: boolean; toolName?: string }> } }).data.messages
    // tool role 不进 content 数组(flatten 为 string),但 metadata 必须保留
    expect(msgs[1].role).toBe('toolResult')
    expect(msgs[1].toolCallId).toBe('call_1')
    expect(msgs[1].toolIsError).toBe(false)
    expect(msgs[1].toolName).toBe('bash')
  })
})
