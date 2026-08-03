/**
 * api/mcp.ts
 *
 * MCP 精选库 (platform 治理层) 前端 API 包装。
 *
 * 后端路由 (apps/web/app/api/admin/mcp/*):
 *   GET    /api/admin/mcp                                 → { servers: McpServer[] }
 *   POST   /api/admin/mcp                                 body=McpServerInput  → { server }
 *   GET    /api/admin/mcp/[id]                            → { server }
 *   PUT    /api/admin/mcp/[id]                            body=Partial<McpServerInput>  → { server }
 *   DELETE /api/admin/mcp/[id]                            → 204
 *   GET    /api/admin/mcp/[id]/bindings                   → { bindings: AgentMcpBinding[] }
 *   PATCH  /api/admin/mcp/[id]/bindings                   body={bindings:[{agentId,mode}]}  → { bindings }
 *
 * 安全契约 (后端凭证隔离铁律):
 *   - configEnc 是客户端用 AES-256-GCM 产生的密文,后端原样存储,永不回传。
 *   - global 作用域的 MCP 严禁携带 configEnc (后端会拒绝并记审计)。
 *   - 所有响应都不含 configEnc 字段 (后端 stripConfig 保证)。
 *
 * 加密格式与后端 lib/secret-crypto.ts 完全一致:
 *   `<iv-hex>:<authTag-hex>:<ciphertext-hex>` (AES-256-GCM, IV=12B, tag=16B)
 *   主密钥来自与后端 APP_ENCRYPTION_KEY 同值的 VITE_APP_ENCRYPTION_KEY (64-hex)。
 */
import request from '@/utils/http'
import type { HttpClient } from '@/utils/http'

const httpClient = request as HttpClient

// ----------------------------------------------------------------------------
// Shapes
// ----------------------------------------------------------------------------

/** MCP 传输协议。stdio = 本地子进程; sse/http = 远程服务。 */
export type McpTransport = 'stdio' | 'sse' | 'http'

/** 作用域。global=全员共享(禁凭证); team=团队; user=个人。 */
export type McpScope = 'global' | 'team' | 'user'

/** Agent↔MCP 绑定模式。inherit=继承上层; include=强制加入; exclude=强制排除。 */
export type BindingMode = 'inherit' | 'include' | 'exclude'

/** 后端返回的 McpServer (configEnc 已被 stripConfig 剥离,永不出现)。 */
export interface McpServer {
  id: string
  name: string
  transport: McpTransport
  endpoint: string
  command: string
  scope: McpScope
  teamId: string | null
  userId: string | null
  enabled: boolean
  createdAt?: string
  updatedAt?: string
}

/** 创建/更新时的输入。configEnc 为可选的客户端加密密文。 */
export interface McpServerInput {
  name: string
  transport?: McpTransport
  endpoint?: string
  command?: string
  /** 客户端 AES-256-GCM 密文;空串=清空凭证。global 作用域会被后端拒绝。 */
  configEnc?: string
  scope: McpScope
  teamId?: string | null
  userId?: string | null
  enabled?: boolean
}

/** Agent 与 MCP 的绑定记录。 */
export interface AgentMcpBinding {
  id: string
  agentId: string
  mcpServerId: string
  mode: BindingMode
}

export interface ListMcpFilters {
  scope?: McpScope
  teamId?: string
}

export interface BindingInput {
  agentId: string
  mode: BindingMode
}

// ----------------------------------------------------------------------------
// API
// ----------------------------------------------------------------------------

interface McpServersResponse {
  servers?: McpServer[]
}
interface McpServerResponse {
  server?: McpServer
}
interface BindingsResponse {
  bindings?: AgentMcpBinding[]
}

/** 列出 MCP 服务器 (configEnc 永不出现)。 */
export async function listMcpServers(filters: ListMcpFilters = {}): Promise<McpServer[]> {
  const res = await httpClient.get<McpServersResponse>({
    url: '/api/admin/mcp',
    params: filters
  })
  return res.servers ?? []
}

/** 获取单个 MCP 服务器详情。 */
export async function getMcpServer(id: string): Promise<McpServer> {
  const res = await httpClient.get<McpServerResponse>({ url: `/api/admin/mcp/${id}` })
  if (!res.server) throw new Error('MCP server not found')
  return res.server
}

/** 创建 MCP 服务器。 */
export async function createMcpServer(data: McpServerInput): Promise<McpServer> {
  const res = await httpClient.post<McpServerResponse>({ url: '/api/admin/mcp', data })
  if (!res.server) throw new Error('create failed')
  return res.server
}

/** 更新 MCP 服务器 (部分字段)。 */
export async function updateMcpServer(id: string, data: Partial<McpServerInput>): Promise<McpServer> {
  const res = await httpClient.put<McpServerResponse>({ url: `/api/admin/mcp/${id}`, data })
  if (!res.server) throw new Error('update failed')
  return res.server
}

/** 删除 MCP 服务器 (事务级联清理绑定)。 */
export async function deleteMcpServer(id: string): Promise<void> {
  await httpClient.request<void>({ url: `/api/admin/mcp/${id}`, method: 'DELETE' })
}

/** 读取某 MCP 服务器当前的 Agent 绑定列表。 */
export async function getMcpBindings(mcpServerId: string): Promise<AgentMcpBinding[]> {
  const res = await httpClient.get<BindingsResponse>({
    url: `/api/admin/mcp/${mcpServerId}/bindings`
  })
  return res.bindings ?? []
}

/** 替换式设置某 MCP 服务器的全部 Agent 绑定 (整体替换,非增量)。 */
export async function setMcpBindings(
  mcpServerId: string,
  bindings: BindingInput[]
): Promise<AgentMcpBinding[]> {
  const res = await httpClient.request<BindingsResponse>({
    url: `/api/admin/mcp/${mcpServerId}/bindings`,
    method: 'PATCH',
    data: { bindings }
  })
  return res.bindings ?? []
}

// ----------------------------------------------------------------------------
// Credential encryption (AES-256-GCM, 与后端 lib/secret-crypto.ts 兼容)
// ----------------------------------------------------------------------------
//
// 使用浏览器原生 Web Crypto API (window.crypto.subtle),密文格式严格匹配后端:
//   `<iv-hex>:<authTag-hex>:<ciphertext-hex>`
//   - IV: 12 字节随机
//   - AuthTag: 16 字节 (subtle 默认拼在密文末尾,需手动分离)
//   - Key: 来自 VITE_APP_ENCRYPTION_KEY (64-hex = 32 字节),与后端 APP_ENCRYPTION_KEY 同值
//
// 安全说明: 主密钥需在构建期通过 VITE_APP_ENCRYPTION_KEY 注入前端。
// 此为内部管理平台 (仅 platform:access 可达),凭证字段本身可选。
// 若密钥未配置,加密不可用并抛出明确错误。

/** Vite 注入的主密钥 (64-hex),与后端 APP_ENCRYPTION_KEY 必须同值。 */
const ENCRYPTION_KEY_HEX: string =
  (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_APP_ENCRYPTION_KEY ?? ''

/** 加密密钥是否已配置 (用于 UI 决定凭证字段是否可用)。 */
export function isCredentialEncryptionConfigured(): boolean {
  return /^[0-9a-fA-F]{64}$/.test(ENCRYPTION_KEY_HEX)
}

/** hex 字符串 → Uint8Array。 */
function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  }
  return out
}

/** Uint8Array → hex 字符串。 */
function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * 用 AES-256-GCM 加密一段明文配置,产生与后端 decryptSecret 兼容的密文信封。
 *
 * @param plaintext 明文 (通常是 MCP 配置 JSON)
 * @returns `<iv-hex>:<authTag-hex>:<ciphertext-hex>`;plaintext 为空时返回空串
 * @throws 当 Web Crypto 不可用或主密钥未配置时抛出明确错误
 */
export async function encryptConfig(plaintext: string): Promise<string> {
  if (!plaintext) return ''
  if (!isCredentialEncryptionConfigured()) {
    throw new Error('凭证加密未配置: 缺少 VITE_APP_ENCRYPTION_KEY (需与后端 APP_ENCRYPTION_KEY 同值)')
  }
  const subtle = globalThis.crypto?.subtle
  if (!subtle) {
    throw new Error('当前环境不支持 Web Crypto API,无法加密凭证')
  }

  const keyRaw = hexToBytes(ENCRYPTION_KEY_HEX)
  const cryptoKey = await subtle.importKey('raw', keyRaw, { name: 'AES-GCM' }, false, ['encrypt'])

  // 12 字节随机 IV (与后端 IV_BYTES 一致)
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12))
  const data = new TextEncoder().encode(plaintext)

  // subtle AES-GCM 默认 tagLength=128 位,且把 authTag 拼在密文末尾 (最后 16 字节)
  const sealed = await subtle.encrypt({ name: 'AES-GCM', iv, tagLength: 128 }, cryptoKey, data)

  const sealedBytes = new Uint8Array(sealed)
  const tagLen = 16
  const ciphertext = sealedBytes.slice(0, sealedBytes.length - tagLen)
  const authTag = sealedBytes.slice(sealedBytes.length - tagLen)

  return `${bytesToHex(iv)}:${bytesToHex(authTag)}:${bytesToHex(ciphertext)}`
}
