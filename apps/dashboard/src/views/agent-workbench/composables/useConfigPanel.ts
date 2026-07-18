/**
 * Models / Skills / Plugins 配置面板 composable
 *
 * 三类配置统一管理:
 *   - models: 全局模型列表(从 ~/.pi/agent/models.json 读取)
 *   - skills: 当前 cwd 下的 SKILL.md 列表
 *   - plugins: 当前 cwd 下已安装的 package 列表
 *
 * 设计要点:
 *   - 内存缓存原始后端响应,setXEnabled 知道如何恢复 disabled 项
 *   - 错误统一暴露 `error: Ref<string|null>` + `clearError()`
 *   - 加载与保存互斥(同一类型在同一时刻只能有一个 in-flight 请求)
 *
 * 不持有 UI 状态(对话框开关、当前选中行等交给组件)。
 */

import { ref, type Ref } from 'vue'
import {
  getModelConfig,
  setModelConfig,
  getSkills,
  setSkillEnabled,
  getPlugins,
  setPluginEnabled
} from '@/api/agent'
import type { ModelConfig, SkillConfig, PluginConfig } from '../types'

function formatError(e: unknown, fallback: string): string {
  if (e instanceof Error) {
    const ax = e as any
    const serverMsg = ax?.response?.data?.error
    if (typeof serverMsg === 'string' && serverMsg.length > 0) return serverMsg
    return e.message || fallback
  }
  return fallback
}

export interface UseConfigPanelResult {
  // Models
  models: Ref<ModelConfig[]>
  loadingModels: Ref<boolean>
  savingModels: Ref<boolean>
  loadModels: () => Promise<void>
  setModelEnabled: (id: string, enabled: boolean) => Promise<void>
  // Skills
  skills: Ref<SkillConfig[]>
  loadingSkills: Ref<boolean>
  savingSkills: Ref<boolean>
  loadSkills: (cwd: string) => Promise<void>
  setSkillEnabled: (id: string, filePath: string, enabled: boolean) => Promise<void>
  // Plugins
  plugins: Ref<PluginConfig[]>
  loadingPlugins: Ref<boolean>
  savingPlugins: Ref<boolean>
  loadPlugins: (cwd: string) => Promise<void>
  setPluginEnabled: (id: string, cwd: string, scope: string, source: string, enabled: boolean) => Promise<void>
  // Shared
  error: Ref<string | null>
  clearError: () => void
}

/** 把 enabled=false 的模型也保留在内存里,启用时能恢复。 */
interface ModelRaw {
  id: string
  name: string
  provider: string
  enabled: boolean
  contextWindow?: number
  filePath?: string
}

export function useConfigPanel(): UseConfigPanelResult {
  const models = ref<ModelConfig[]>([])
  const loadingModels = ref(false)
  const savingModels = ref(false)

  const skills = ref<SkillConfig[]>([])
  const loadingSkills = ref(false)
  const savingSkills = ref(false)

  const plugins = ref<PluginConfig[]>([])
  const loadingPlugins = ref(false)
  const savingPlugins = ref(false)

  const error = ref<string | null>(null)
  function clearError() {
    error.value = null
  }

  // ---------- Models ----------
  /** 缓存: id -> raw(含 enabled 状态,用于 setModelEnabled 时回写) */
  const modelRawById = new Map<string, ModelRaw>()

  async function loadModels() {
    loadingModels.value = true
    try {
      const list = await getModelConfig()
      models.value = list.map((m) => {
        const raw: ModelRaw = { ...m }
        modelRawById.set(m.id, raw)
        return m
      })
      error.value = null
    } catch (e: unknown) {
      error.value = formatError(e, '加载模型配置失败')
    } finally {
      loadingModels.value = false
    }
  }

  async function setModelEnabled(id: string, enabled: boolean) {
    if (savingModels.value) return
    const idx = models.value.findIndex((m) => m.id === id)
    if (idx === -1) return
    const prev = models.value[idx].enabled
    if (prev === enabled) return
    // 乐观更新
    models.value = models.value.map((m) => (m.id === id ? { ...m, enabled } : m))
    savingModels.value = true
    try {
      await setModelConfig(id, enabled)
    } catch (e: unknown) {
      // 回滚
      models.value = models.value.map((m) => (m.id === id ? { ...m, enabled: prev } : m))
      error.value = formatError(e, '保存模型配置失败')
    } finally {
      savingModels.value = false
    }
  }

  // ---------- Skills ----------
  async function loadSkills(cwd: string) {
    if (!cwd) return
    loadingSkills.value = true
    try {
      const list = await getSkills(cwd)
      skills.value = list
      error.value = null
    } catch (e: unknown) {
      error.value = formatError(e, '加载技能列表失败')
    } finally {
      loadingSkills.value = false
    }
  }

  async function setSkillEnabledAction(id: string, filePath: string, enabled: boolean) {
    if (savingSkills.value) return
    const idx = skills.value.findIndex((s) => s.id === id)
    if (idx === -1) return
    const prev = skills.value[idx].enabled
    if (prev === enabled) return
    skills.value = skills.value.map((s) => (s.id === id ? { ...s, enabled } : s))
    savingSkills.value = true
    try {
      await setSkillEnabled(filePath, enabled)
    } catch (e: unknown) {
      skills.value = skills.value.map((s) => (s.id === id ? { ...s, enabled: prev } : s))
      error.value = formatError(e, '保存技能状态失败')
    } finally {
      savingSkills.value = false
    }
  }

  // ---------- Plugins ----------
  /** plugin id 形如 "global::npm:foo@1.0" — 需要拆分回 scope + source */
  function parsePluginId(id: string): { scope: string; source: string } | null {
    const idx = id.indexOf('::')
    if (idx === -1) return null
    return { scope: id.slice(0, idx), source: id.slice(idx + 2) }
  }

  async function loadPlugins(cwd: string) {
    if (!cwd) return
    loadingPlugins.value = true
    try {
      const list = await getPlugins(cwd)
      plugins.value = list
      error.value = null
    } catch (e: unknown) {
      error.value = formatError(e, '加载插件列表失败')
    } finally {
      loadingPlugins.value = false
    }
  }

  async function setPluginEnabledAction(
    id: string,
    cwd: string,
    scope: string,
    source: string,
    enabled: boolean
  ) {
    if (savingPlugins.value) return
    const idx = plugins.value.findIndex((p) => p.id === id)
    if (idx === -1) return
    const prev = plugins.value[idx].enabled
    if (prev === enabled) return
    plugins.value = plugins.value.map((p) => (p.id === id ? { ...p, enabled } : p))
    savingPlugins.value = true
    try {
      await setPluginEnabled(cwd, scope, source, enabled)
    } catch (e: unknown) {
      plugins.value = plugins.value.map((p) => (p.id === id ? { ...p, enabled: prev } : p))
      error.value = formatError(e, '保存插件状态失败')
    } finally {
      savingPlugins.value = false
    }
  }

  return {
    models,
    loadingModels,
    savingModels,
    loadModels,
    setModelEnabled,
    skills,
    loadingSkills,
    savingSkills,
    loadSkills,
    setSkillEnabled: setSkillEnabledAction,
    plugins,
    loadingPlugins,
    savingPlugins,
    loadPlugins,
    setPluginEnabled: setPluginEnabledAction,
    error,
    clearError
  }
}