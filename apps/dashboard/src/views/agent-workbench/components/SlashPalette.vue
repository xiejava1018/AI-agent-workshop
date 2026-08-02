<script setup lang="ts">
  /**
   * SlashPalette —— slash 命令面板(T5.2)。
   *
   * 设计:
   * - Props 接收 query / items(已过滤)/ activeIndex;不做内部过滤 / 不引入 useAgentSession,
   *   父级 ChatInput 负责合并 builtin + session commands 并过滤后传 items 进来。
   * - 键盘事件(↑↓ / Enter / Escape)由父级 ChatInput 拦截后通过 update:activeIndex / select
   *   事件回写,palette 自身不挂 window keydown。
   * - a11y:role="listbox" + 每项 role="option" + aria-activedescendant 指向 activeIndex 项的 id。
   *
   * 命中排序(由父级做,palette 仅展示):
   *   1) 精确前缀:item.name.startsWith(query) 或 aliases.some(startsWith(query))
   *   2) 包含:item.name.includes(query) 或 aliases.some(includes(query))
   *   3) 字符级子序列:query 字符按顺序在 item.name 中出现
   */
  import { computed } from 'vue'
  import type { SlashCommandPaletteItem } from '../types'

  interface Props {
    query: string
    items: SlashCommandPaletteItem[]
    activeIndex: number
  }

  const props = withDefaults(defineProps<Props>(), {
    query: '',
    items: () => [],
    activeIndex: 0
  })

  const emit = defineEmits<{
    select: [item: SlashCommandPaletteItem]
    'update:activeIndex': [index: number]
    close: []
  }>()

  /** listbox 元素的 id(aria-activedescendant 引用) */
  const listboxId = 'wb-slash-palette-listbox'

  /** 每项 option 的稳定 id:用 index 即可,palette 不会跨 query 重排位置 */
  function optionId(index: number): string {
    return `${listboxId}-option-${index}`
  }

  /** 当前 active 项的 id(用于 aria-activedescendant） */
  const activeDescendant = computed<string | undefined>(() => {
    if (props.activeIndex < 0 || props.activeIndex >= props.items.length) return undefined
    return optionId(props.activeIndex)
  })

  function handleClick(item: SlashCommandPaletteItem): void {
    emit('select', item)
  }

  function handleMouseEnter(index: number): void {
    if (index !== props.activeIndex) {
      emit('update:activeIndex', index)
    }
  }

  /** 仅暴露给父级调试用 —— 由父级 ChatInput 通过模板 ref 调用 */
  defineExpose({
    listboxId
  })
</script>

<template>
  <div class="wb-slash-palette" data-testid="wb-slash-palette">
    <ul
      :id="listboxId"
      class="wb-slash-palette__list"
      role="listbox"
      :aria-activedescendant="activeDescendant"
      aria-label="Slash 命令面板"
    >
      <li
        v-for="(item, idx) in items"
        :id="optionId(idx)"
        :key="item.name"
        class="wb-slash-palette__item"
        :class="{ 'is-active': idx === activeIndex }"
        role="option"
        :aria-selected="idx === activeIndex"
        :data-slash-name="item.name"
        @click="handleClick(item)"
        @mouseenter="handleMouseEnter(idx)"
      >
        <span class="wb-slash-palette__name">{{ item.name }}</span>
        <span v-if="item.aliases.length > 0" class="wb-slash-palette__aliases">
          {{ item.aliases.join(' / ') }}
        </span>
        <span class="wb-slash-palette__desc">{{ item.description }}</span>
      </li>
      <li
        v-if="items.length === 0"
        class="wb-slash-palette__empty"
        role="presentation"
      >
        无匹配命令
      </li>
    </ul>
  </div>
</template>

<style scoped>
  .wb-slash-palette {
    position: absolute;
    top: 100%;
    left: 0;
    right: 0;
    z-index: 1000;
    margin-top: 4px;
    background: var(--wb-surface, #fff);
    border: 1px solid var(--wb-border, #dcdfe6);
    border-radius: 6px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
    max-height: 240px;
    overflow-y: auto;
  }

  .wb-slash-palette__list {
    list-style: none;
    margin: 0;
    padding: 4px 0;
  }

  .wb-slash-palette__item {
    display: flex;
    align-items: baseline;
    gap: 8px;
    padding: 6px 12px;
    cursor: pointer;
    font-size: 13px;
    line-height: 1.4;
  }

  .wb-slash-palette__item.is-active {
    background: var(--wb-hover, #f5f7fa);
  }

  .wb-slash-palette__name {
    font-weight: 600;
    color: var(--wb-accent, #409eff);
    min-width: 80px;
  }

  .wb-slash-palette__aliases {
    color: var(--wb-text-dim, #909399);
    font-size: 12px;
    min-width: 60px;
  }

  .wb-slash-palette__desc {
    color: var(--wb-text, #303133);
    flex: 1;
  }

  .wb-slash-palette__empty {
    padding: 8px 12px;
    color: var(--wb-text-dim, #909399);
    font-size: 13px;
    text-align: center;
  }
</style>
