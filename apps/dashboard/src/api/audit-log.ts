import request from '@/utils/http'

/** 后端 /api/admin/audit 入参(扁平字段)。 */
export interface AuditLogListParams {
  page?: number
  limit?: number
  userId?: string
  action?: string
  resourceType?: string
  resourceId?: string
  from?: string
  to?: string
}

/** 后端 AuditLog 行(camelCase)。 */
interface BackendAuditLogEntry {
  id: string
  userId?: string | null
  action: string
  resourceType: string
  resourceId?: string | null
  metadata?: string | null
  createdAt: string
}

/** 后端分页响应。 */
interface BackendAuditLogResponse {
  entries: BackendAuditLogEntry[]
  total: number
  page: number
  limit: number
}

/** 前端表格消费的行(snake_case)。 */
export interface AuditLogItem {
  id: string
  user_id?: string | null
  action: string
  resource_type: string
  resource_id?: string | null
  metadata?: string | null
  created_at?: string
}

/** useTable 需要的标准化列表响应。 */
export interface AuditLogListResponse {
  records: AuditLogItem[]
  total: number
  current?: number
  size?: number
}

function toRow(entry: BackendAuditLogEntry): AuditLogItem {
  return {
    id: entry.id,
    user_id: entry.userId ?? null,
    action: entry.action,
    resource_type: entry.resourceType,
    resource_id: entry.resourceId ?? null,
    metadata: entry.metadata ?? null,
    created_at: entry.createdAt,
  }
}

/**
 * 获取审计日志列表(分页)
 *
 * useTable 内部以 current/size 维护分页,后端用 page/limit;
 * 这里做一次映射,并返回 { records, total } 供 defaultResponseAdapter 消费。
 */
export function getAuditLogList(params?: Api.AuditLog.AuditLogSearchParams): Promise<AuditLogListResponse> {
  const p = (params ?? {}) as Record<string, unknown>
  const page = Number((p.current as number) ?? (p.page as number) ?? 1)
  const limit = Number((p.size as number) ?? (p.page_size as number) ?? 20)

  const query: Record<string, string> = {
    page: String(Number.isFinite(page) && page >= 1 ? page : 1),
    limit: String(Number.isFinite(limit) && limit >= 1 ? limit : 20),
  }
  const userId = p.user_id ?? p.userId
  const action = p.action
  const resourceType = p.resource_type ?? p.resourceType
  const startDate = p.start_date ?? p.from
  const endDate = p.end_date ?? p.to
  if (typeof userId === 'string' && userId) query.userId = userId
  if (typeof action === 'string' && action) query.action = action
  if (typeof resourceType === 'string' && resourceType) query.resourceType = resourceType
  if (typeof startDate === 'string' && startDate) query.from = startDate
  if (typeof endDate === 'string' && endDate) {
    // 后端 to 为闭区间;只传日期时补到当天结束,保证当天事件命中。
    query.to = endDate.length <= 10 ? `${endDate}T23:59:59.999Z` : endDate
  }

  return request.get<BackendAuditLogResponse>({
    url: '/api/admin/audit',
    params: query,
    keepFullResponse: true,
    showErrorMessage: false,
  }).then((res) => {
    const data = (res ?? {}) as BackendAuditLogResponse
    const entries = Array.isArray(data.entries) ? data.entries : []
    return {
      records: entries.map(toRow),
      total: typeof data.total === 'number' ? data.total : entries.length,
      current: data.page,
      size: data.limit,
    }
  })
}

/** 获取审计日志详情 */
export function getAuditLogDetail(id: string): Promise<AuditLogItem> {
  return request
    .get<{ entry: BackendAuditLogEntry }>({
      url: `/api/admin/audit/${encodeURIComponent(id)}`,
      showErrorMessage: false,
    })
    .then((res) => toRow((res as { entry: BackendAuditLogEntry }).entry))
}

/** 触发后端 CSV 导出下载。返回 Blob 与文件名。 */
export async function exportAuditLogs(params: AuditLogListParams): Promise<{ blob: Blob; filename: string }> {
  const query: Record<string, string> = {}
  if (params.userId) query.userId = params.userId
  if (params.action) query.action = params.action
  if (params.resourceType) query.resourceType = params.resourceType
  if (params.resourceId) query.resourceId = params.resourceId
  if (params.from) query.from = params.from
  if (params.to) {
    query.to = params.to.length <= 10 ? `${params.to}T23:59:59.999Z` : params.to
  }

  const { default: axios } = await import('axios')
  const res = await axios.get('/api/admin/audit/export', {
    params: query,
    responseType: 'blob',
    withCredentials: true,
    timeout: 30000,
  })

  const dispo = res.headers['content-disposition'] || ''
  let filename = `audit_logs.csv`
  const match = /filename="?([^";]+)"?/i.exec(dispo)
  if (match && match[1]) filename = match[1].trim()
  return { blob: res.data as Blob, filename }
}
