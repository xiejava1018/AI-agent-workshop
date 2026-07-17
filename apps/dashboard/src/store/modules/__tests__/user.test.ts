/**
 * T6.5 — userStore M4 RBAC permission-check unit tests.
 *
 * Tests the REAL pure helpers in @/utils/permissions, which userStore.hasPermission
 * / hasAnyPermission delegate to. Importing the real module (not re-declaring the
 * logic here) means the test breaks if the contract changes — no false confidence.
 *
 * The store wiring itself (permissions.value → hasPermission) is verified via the
 * v-auth directive test (directives/core/__tests__/auth.test.ts), which drives
 * the real permission flow end-to-end.
 */
import { describe, it, expect } from 'vitest'
import { hasPermission, hasAnyPermission } from '@/utils/permissions'

describe('hasPermission', () => {
  it('returns false when permissions are empty (not loaded)', () => {
    expect(hasPermission(new Set(), 'user:view')).toBe(false)
  })

  it('returns true when the permission code exists in the set', () => {
    const perms = new Set(['user:view', 'role:edit'])
    expect(hasPermission(perms, 'user:view')).toBe(true)
    expect(hasPermission(perms, 'role:edit')).toBe(true)
  })

  it('returns false for a code not in the set', () => {
    expect(hasPermission(new Set(['user:view']), 'user:delete')).toBe(false)
  })

  it('returns false for an empty string code', () => {
    expect(hasPermission(new Set(['user:view']), '')).toBe(false)
  })
})

describe('hasAnyPermission', () => {
  it('returns false when permissions are empty', () => {
    expect(hasAnyPermission(new Set(), ['user:view', 'role:edit'])).toBe(false)
  })

  it('returns true when at least one code matches (OR semantics)', () => {
    expect(hasAnyPermission(new Set(['user:view']), ['user:view', 'role:edit'])).toBe(true)
  })

  it('returns false when none of the codes match', () => {
    expect(hasAnyPermission(new Set(['user:view']), ['role:edit', 'menu:delete'])).toBe(false)
  })

  it('returns false when called with no codes', () => {
    expect(hasAnyPermission(new Set(['user:view']), [])).toBe(false)
  })

  it('returns true when all codes match', () => {
    const perms = new Set(['user:view', 'role:edit'])
    expect(hasAnyPermission(perms, ['user:view', 'role:edit'])).toBe(true)
  })
})

describe('permission-check on a realistically populated set (auth/me shape)', () => {
  // Simulates the Set userStore builds from /api/auth/me permissions[]
  const perms = new Set(['user:view', 'user:create', 'platform:access'])

  it('grants platform:access for a platform admin', () => {
    expect(hasPermission(perms, 'platform:access')).toBe(true)
  })

  it('OR-checks across module boundaries', () => {
    expect(hasAnyPermission(perms, ['role:edit', 'platform:access'])).toBe(true)
    expect(hasAnyPermission(perms, ['role:edit', 'menu:delete'])).toBe(false)
  })
})
