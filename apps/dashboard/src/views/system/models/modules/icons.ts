/**
 * modules/icons.ts
 *
 * 40 个 provider 的图标映射。 完全复刻 React ModelsConfig.tsx:41-83 的映射
 * (Anthropic → zai 等)。 hasColor=true 表示 Color 图标(self-colored SVG),
 * hasColor=false 表示 Mono 图标(用 currentColor 继承主题)。
 *
 * 未知 id: 渲染首两个字母的小方块作为 placeholder。
 *
 * ----------------------------------------------------------------------------
 * 实现说明: 改用主入口 `import * as LobeIcons from '@lobehub/icons'` + 运行时
 * 解析 `.Color` 子组件, 取代深层子路径导入(如 `@lobehub/icons/es/X/components/Mono`)。
 * 深层路径在 vite optimizeDeps 预构建后会失效(包被打成单 chunk, es/ 子结构不再可寻址)。
 * 主入口经预构建后稳定可用, 且聚合导出了全部品牌(Anthropic/OpenAI/Google/Groq/...)。
 * 每个品牌是 CompoundedIcon: 默认导出=Mono, 且带 `.Color` 属性(见 es/Google/index.d.ts)。
 * 运行时逐个解析, 任一品牌/变体缺失则降级到 placeholder(首字母方块), 永不报错。
 */
import { defineComponent, h, computed } from 'vue'
import * as LobeIcons from '@lobehub/icons'

interface IconEntry {
  /** @lobehub/icons 主入口的命名导出名, 如 'Anthropic' */
  brand: string
  hasColor: boolean
}

const PROVIDER_ICONS: Record<string, IconEntry> = {
  anthropic: { brand: 'Anthropic', hasColor: false },
  openai: { brand: 'OpenAI', hasColor: false },
  'openai-codex': { brand: 'OpenAI', hasColor: false },
  google: { brand: 'Google', hasColor: true },
  'google-vertex': { brand: 'Google', hasColor: true },
  'ant-ling': { brand: 'AntGroup', hasColor: true },
  deepseek: { brand: 'DeepSeek', hasColor: true },
  groq: { brand: 'Groq', hasColor: false },
  mistral: { brand: 'Mistral', hasColor: true },
  moonshotai: { brand: 'Moonshot', hasColor: false },
  'moonshotai-cn': { brand: 'Moonshot', hasColor: false },
  moonshot: { brand: 'Moonshot', hasColor: false },
  minimax: { brand: 'Minimax', hasColor: true },
  'minimax-cn': { brand: 'Minimax', hasColor: true },
  fireworks: { brand: 'Fireworks', hasColor: true },
  huggingface: { brand: 'HuggingFace', hasColor: true },
  cerebras: { brand: 'Cerebras', hasColor: true },
  openrouter: { brand: 'OpenRouter', hasColor: false },
  xai: { brand: 'XAI', hasColor: false },
  'cloudflare-ai-gateway': { brand: 'Cloudflare', hasColor: true },
  'cloudflare-workers-ai': { brand: 'Cloudflare', hasColor: true },
  'vercel-ai-gateway': { brand: 'Vercel', hasColor: false },
  'github-copilot': { brand: 'GithubCopilot', hasColor: false },
  'amazon-bedrock': { brand: 'Aws', hasColor: true },
  'azure-openai-responses': { brand: 'Azure', hasColor: true },
  'kimi-coding': { brand: 'Kimi', hasColor: true },
  nvidia: { brand: 'Nvidia', hasColor: true },
  opencode: { brand: 'OpenCode', hasColor: false },
  'opencode-go': { brand: 'OpenCode', hasColor: false },
  qwen: { brand: 'Qwen', hasColor: true },
  xiaomi: { brand: 'XiaomiMiMo', hasColor: false },
  'xiaomi-token-plan-ams': { brand: 'XiaomiMiMo', hasColor: false },
  'xiaomi-token-plan-cn': { brand: 'XiaomiMiMo', hasColor: false },
  'xiaomi-token-plan-sgp': { brand: 'XiaomiMiMo', hasColor: false },
  zai: { brand: 'ZAI', hasColor: false },
  'zai-coding-cn': { brand: 'ZAI', hasColor: false },
  zhipu: { brand: 'Zhipu', hasColor: true },
  cohere: { brand: 'Cohere', hasColor: true },
  perplexity: { brand: 'Perplexity', hasColor: true },
  together: { brand: 'Together', hasColor: true },
  grok: { brand: 'Grok', hasColor: false }
}

/**
 * 运行时解析品牌图标组件。
 * - hasColor=true: 优先取 Brand.Color; 无则回退默认(自着色兜底)。
 * - hasColor=false: 取 Brand 默认导出(CompoundedIcon 默认即 Mono)。
 * - 任一步缺失返回 null(调用方走 placeholder)。
 */
function resolveIcon(entry: IconEntry): any | null {
  const Brand = (LobeIcons as Record<string, any>)[entry.brand]
  if (!Brand) return null
  if (entry.hasColor) {
    return Brand.Color || Brand
  }
  return Brand
}

function placeholderLetters(id: string): string {
  return (
    id
      .split(/[-_]/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0])
      .join('')
      .toUpperCase() || '?'
  )
}

export default defineComponent({
  name: 'ProviderIcon',
  props: {
    id: { type: String, required: true },
    size: { type: Number, default: 18 }
  },
  setup(props) {
    const entry = computed(() => PROVIDER_ICONS[props.id])
    const fontSize = computed(() => Math.max(8, Math.floor(props.size * 0.42)))
    const letters = computed(() => placeholderLetters(props.id))
    const IconComp = computed(() => (entry.value ? resolveIcon(entry.value) : null))

    return () => {
      const e = entry.value
      const Comp = IconComp.value
      // 无映射 / 品牌不存在 / 组件解析失败 → placeholder
      if (!e || !Comp) {
        return h(
          'span',
          {
            'aria-hidden': 'true',
            style: {
              width: `${props.size}px`,
              height: `${props.size}px`,
              border: '1px solid var(--el-border-color-light, var(--el-border-color-lighter))',
              borderRadius: '4px',
              color: 'var(--el-text-color-placeholder)',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              fontSize: `${fontSize.value}px`,
              fontWeight: 700,
              lineHeight: 1
            }
          },
          letters.value
        )
      }
      if (e.hasColor) {
        return h(Comp, { size: props.size })
      }
      return h(Comp, { size: props.size, style: { color: 'var(--el-text-color-secondary)' } })
    }
  }
})
