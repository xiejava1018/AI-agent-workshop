/**
 * api/curated-skills.ts
 *
 * 技能精选库 (platform 治理层) 前端 API 包装。
 *
 * 后端路由 (apps/web/app/api/admin/curated-skills/*):
 *   GET    /api/admin/curated-skills?category=&tag=&featured=&enabled=&q=&limit=&offset=
 *   POST   /api/admin/curated-skills                         body=CuratedSkillInput
 *   GET    /api/admin/curated-skills/[id]
 *   PATCH  /api/admin/curated-skills/[id]                    body=Partial<CuratedSkillInput>
 *   DELETE /api/admin/curated-skills/[id]                    → 204
 *   GET    /api/admin/curated-skills/categories              → { categories: [{category,count}] }
 *   POST   /api/admin/curated-skills/seed-from-builtin       → { created, updated, skipped, total }
 *
 * 设计: openspec/changes/skill-curated-library/design.md §3
 */
import request from '@/utils/http'

// ----------------------------------------------------------------------------
// Shapes
// ----------------------------------------------------------------------------

export type CuratedSourceKind = 'builtin' | 'local' | 'remote' | 'package'
export type CuratedVisibility = 'global' | 'team' | 'user'

export interface CuratedSkillMeta {
  id: string
  slug: string
  name: string
  description: string
  summary: string
  category: string
  tags: string[]
  icon: string
  version: string
  author: string
  sourceKind: CuratedSourceKind
  sourceFilePath: string
  sourceBuiltinPath: string
  sourceUrl: string
  visibility: CuratedVisibility
  featured: boolean
  enabled: boolean
  installCount: number
  createdBy: string | null
  createdAt: string
  updatedAt: string
}

export interface CuratedSkillInput {
  slug: string
  name: string
  description?: string
  summary?: string
  category?: string
  tags?: string[]
  icon?: string
  version?: string
  author?: string
  sourceKind?: CuratedSourceKind
  sourceFilePath?: string
  sourceBuiltinPath?: string
  sourceUrl?: string
  visibility?: CuratedVisibility
  featured?: boolean
  enabled?: boolean
  installCount?: number
}

export interface ListCuratedFilters {
  category?: string
  tag?: string
  featured?: boolean
  enabled?: boolean
  q?: string
  limit?: number
  offset?: number
}

export interface ListCuratedResult {
  entries: CuratedSkillMeta[]
  total: number
  limit: number
  offset: number
}

export interface CategoryCount {
  category: string
  count: number
}

export interface SeedFromBuiltinResult {
  created: number
  updated: number
  skipped: number
  total: number
}

// ----------------------------------------------------------------------------
// API
// ----------------------------------------------------------------------------

export function listCuratedSkills(filters: ListCuratedFilters = {}): Promise<ListCuratedResult> {
  return request.get<ListCuratedResult>({
    url: '/api/admin/curated-skills',
    params: filters
  })
}

export function getCuratedSkill(id: string): Promise<CuratedSkillMeta> {
  return request.get<CuratedSkillMeta>({ url: `/api/admin/curated-skills/${id}` })
}

export function createCuratedSkill(data: CuratedSkillInput): Promise<CuratedSkillMeta> {
  return request.post<CuratedSkillMeta>({ url: '/api/admin/curated-skills', data })
}

export function updateCuratedSkill(
  id: string,
  data: Partial<CuratedSkillInput>
): Promise<CuratedSkillMeta> {
  return request.request<CuratedSkillMeta>({
    url: `/api/admin/curated-skills/${id}`,
    method: 'PATCH',
    data
  })
}

export function deleteCuratedSkill(id: string): Promise<void> {
  return request.request<void>({
    url: `/api/admin/curated-skills/${id}`,
    method: 'DELETE'
  })
}

export function listCuratedCategories(): Promise<{ categories: CategoryCount[] }> {
  return request.get<{ categories: CategoryCount[] }>({
    url: '/api/admin/curated-skills/categories'
  })
}

export function seedFromBuiltin(): Promise<SeedFromBuiltinResult> {
  return request.post<SeedFromBuiltinResult>({
    url: '/api/admin/curated-skills/seed-from-builtin',
    data: {}
  })
}
