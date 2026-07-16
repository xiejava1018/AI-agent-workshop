import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

/**
 * 字典状态
 * AI-agent-workshop 后端暂无字典接口，所有字典直接从本地空缓存返回。
 */
export const useDictStore = defineStore('dictStore', () => {
  /** 字典缓存 */
  const cache = ref<Record<string, Api.SystemDict.DictItem[]>>({})
  /** 是否已加载 */
  const loaded = ref(false)

  /**
   * 加载所有字典数据（空实现）
   */
  async function loadAll() {
    loaded.value = true
    return
  }

  /**
   * 按类型加载（空实现）
   */
  async function loadByType(_dictType: string) {
    return
  }

  /**
   * 刷新某类型缓存（空实现）
   */
  async function refreshType(_dictType: string) {
    return
  }

  /** 获取原始字典项列表 */
  const getDict = computed(
    () => (dictType: string) => cache.value[dictType] || []
  )

  /** 获取选项列表 { label, value, color }[] */
  const getOptions = computed(
    () =>
      (dictType: string): { label: string; value: string; color?: string }[] => {
        const items = cache.value[dictType] || []
        return items.map((item) => ({
          label: item.dict_label,
          value: item.dict_code,
          color: item.color || undefined
        }))
      }
  )

  /** 获取 code → label 映射 */
  const getLabelMap = computed(
    () =>
      (dictType: string): Record<string, string> => {
        const items = cache.value[dictType] || []
        const map: Record<string, string> = {}
        for (const item of items) {
          map[item.dict_code] = item.dict_label
        }
        return map
      }
  )

  /** 获取 code → color 映射 */
  const getColorMap = computed(
    () =>
      (dictType: string): Record<string, string | undefined> => {
        const items = cache.value[dictType] || []
        const map: Record<string, string | undefined> = {}
        for (const item of items) {
          map[item.dict_code] = item.color || undefined
        }
        return map
      }
  )

  return {
    cache,
    loaded,
    loadAll,
    loadByType,
    refreshType,
    getDict,
    getOptions,
    getLabelMap,
    getColorMap
  }
})
