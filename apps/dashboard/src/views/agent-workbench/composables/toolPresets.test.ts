import { describe, expect, it } from 'vitest'
import {
  getToolNamesForPreset,
  PRESET_DEFAULT,
  PRESET_FULL,
  PRESET_NONE,
  type ToolPreset
} from '@/api/agent'

/**
 * T7.1 — getToolNamesForPreset 单元覆盖。
 *
 * 函数实际位置在 @/api/agent(纯函数,无 IO);按 plan 把测试落在
 * composables 目录,import 走真实路径。三档映射写死,与 apps/web
 * lib/tool-presets.ts 对齐——不走 allTools 过滤(design §3.1 草稿的
 * 偏差,见源码注释)。
 */
describe('getToolNamesForPreset', () => {
  it('returns an empty list for the "none" preset', () => {
    // Arrange
    const preset: ToolPreset = 'none'

    // Act
    const result = getToolNamesForPreset(preset)

    // Assert
    expect(result).toEqual([])
    // 返回的是 spread 副本,调用方 mutate 不会污染导出常量
    expect(result).not.toBe(PRESET_NONE)
  })

  it('returns the core tool names for the "default" preset', () => {
    // Arrange
    const preset: ToolPreset = 'default'

    // Act
    const result = getToolNamesForPreset(preset)

    // Assert
    expect(result).toEqual(['read', 'bash', 'edit', 'write'])
    expect(result).not.toBe(PRESET_DEFAULT)
  })

  it('returns the full built-in tool name list for the "full" preset', () => {
    // Arrange
    const preset: ToolPreset = 'full'

    // Act
    const result = getToolNamesForPreset(preset)

    // Assert
    expect(result).toEqual(['bash', 'read', 'edit', 'write', 'grep', 'find', 'ls'])
    expect(result).not.toBe(PRESET_FULL)
  })
})
