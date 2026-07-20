/**
 * Vue 端内置 slash 命令清单(T5.1)。
 *
 * 注意:
 * - 列表是不可变的 readonly 数组,不要在运行时 push / splice
 * - 这里只列 builtin,会话级命令由 useAgentSession.loadSlashCommands() 加载后
 *   在 ChatInput 里合并到 palette
 * - 中文 alias 在 listbox 展示时跟 name / description 并列,命中规则走 3 档
 *   模糊匹配(prefix > contains > subsequence)
 */
import type { SlashCommandPaletteItem } from '../types'

export const BUILTIN_SLASH_COMMANDS: ReadonlyArray<SlashCommandPaletteItem> = [
  {
    name: '/compact',
    aliases: ['/压缩'],
    description: '压缩上下文',
    source: 'builtin'
  },
  {
    name: '/branch',
    aliases: [],
    description: '分叉当前 assistant 消息',
    source: 'builtin'
  },
  {
    name: '/model',
    aliases: [],
    description: '切换模型',
    source: 'builtin'
  },
  {
    name: '/fork',
    aliases: [],
    description: '分叉当前 entry',
    source: 'builtin'
  }
]
