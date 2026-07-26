/**
 * modules/icons.ts
 *
 * 40 个 provider 的图标映射。 完全复刻 React ModelsConfig.tsx:41-83 的映射
 * (Anthropic → zai 等)。 hasColor=true 表示 Color 图标(self-colored SVG),
 * hasColor=false 表示 Mono 图标(用 currentColor 继承主题)。
 *
 * 未知 id: 渲染首两个字母的小方块作为 placeholder。
 */
import { defineComponent, h, computed } from 'vue'

import AnthropicIcon from '@lobehub/icons/es/Anthropic/components/Mono'
import OpenAIIcon from '@lobehub/icons/es/OpenAI/components/Mono'
import GoogleColorIcon from '@lobehub/icons/es/Google/components/Color'
import AntGroupColorIcon from '@lobehub/icons/es/AntGroup/components/Color'
import DeepSeekColorIcon from '@lobehub/icons/es/DeepSeek/components/Color'
import GroqIcon from '@lobehub/icons/es/Groq/components/Mono'
import MistralColorIcon from '@lobehub/icons/es/Mistral/components/Color'
import MoonshotIcon from '@lobehub/icons/es/Moonshot/components/Mono'
import MinimaxColorIcon from '@lobehub/icons/es/Minimax/components/Color'
import FireworksColorIcon from '@lobehub/icons/es/Fireworks/components/Color'
import HuggingFaceColorIcon from '@lobehub/icons/es/HuggingFace/components/Color'
import CerebrasColorIcon from '@lobehub/icons/es/Cerebras/components/Color'
import OpenRouterIcon from '@lobehub/icons/es/OpenRouter/components/Mono'
import XAIIcon from '@lobehub/icons/es/XAI/components/Mono'
import CloudflareColorIcon from '@lobehub/icons/es/Cloudflare/components/Color'
import VercelIcon from '@lobehub/icons/es/Vercel/components/Mono'
import GithubCopilotIcon from '@lobehub/icons/es/GithubCopilot/components/Mono'
import AwsColorIcon from '@lobehub/icons/es/Aws/components/Color'
import AzureColorIcon from '@lobehub/icons/es/Azure/components/Color'
import KimiColorIcon from '@lobehub/icons/es/Kimi/components/Color'
import NvidiaColorIcon from '@lobehub/icons/es/Nvidia/components/Color'
import OpenCodeIcon from '@lobehub/icons/es/OpenCode/components/Mono'
import QwenColorIcon from '@lobehub/icons/es/Qwen/components/Color'
import XiaomiMiMoIcon from '@lobehub/icons/es/XiaomiMiMo/components/Mono'
import ZAIIcon from '@lobehub/icons/es/ZAI/components/Mono'
import ZhipuColorIcon from '@lobehub/icons/es/Zhipu/components/Color'
import CohereColorIcon from '@lobehub/icons/es/Cohere/components/Color'
import PerplexityColorIcon from '@lobehub/icons/es/Perplexity/components/Color'
import TogetherColorIcon from '@lobehub/icons/es/Together/components/Color'
import GrokIcon from '@lobehub/icons/es/Grok/components/Mono'

interface IconEntry {
  Icon: any
  hasColor: boolean
}

const PROVIDER_ICONS: Record<string, IconEntry> = {
  anthropic: { Icon: AnthropicIcon, hasColor: false },
  openai: { Icon: OpenAIIcon, hasColor: false },
  'openai-codex': { Icon: OpenAIIcon, hasColor: false },
  google: { Icon: GoogleColorIcon, hasColor: true },
  'google-vertex': { Icon: GoogleColorIcon, hasColor: true },
  'ant-ling': { Icon: AntGroupColorIcon, hasColor: true },
  deepseek: { Icon: DeepSeekColorIcon, hasColor: true },
  groq: { Icon: GroqIcon, hasColor: false },
  mistral: { Icon: MistralColorIcon, hasColor: true },
  moonshotai: { Icon: MoonshotIcon, hasColor: false },
  'moonshotai-cn': { Icon: MoonshotIcon, hasColor: false },
  moonshot: { Icon: MoonshotIcon, hasColor: false },
  minimax: { Icon: MinimaxColorIcon, hasColor: true },
  'minimax-cn': { Icon: MinimaxColorIcon, hasColor: true },
  fireworks: { Icon: FireworksColorIcon, hasColor: true },
  huggingface: { Icon: HuggingFaceColorIcon, hasColor: true },
  cerebras: { Icon: CerebrasColorIcon, hasColor: true },
  openrouter: { Icon: OpenRouterIcon, hasColor: false },
  xai: { Icon: XAIIcon, hasColor: false },
  'cloudflare-ai-gateway': { Icon: CloudflareColorIcon, hasColor: true },
  'cloudflare-workers-ai': { Icon: CloudflareColorIcon, hasColor: true },
  'vercel-ai-gateway': { Icon: VercelIcon, hasColor: false },
  'github-copilot': { Icon: GithubCopilotIcon, hasColor: false },
  'amazon-bedrock': { Icon: AwsColorIcon, hasColor: true },
  'azure-openai-responses': { Icon: AzureColorIcon, hasColor: true },
  'kimi-coding': { Icon: KimiColorIcon, hasColor: true },
  nvidia: { Icon: NvidiaColorIcon, hasColor: true },
  opencode: { Icon: OpenCodeIcon, hasColor: false },
  'opencode-go': { Icon: OpenCodeIcon, hasColor: false },
  qwen: { Icon: QwenColorIcon, hasColor: true },
  xiaomi: { Icon: XiaomiMiMoIcon, hasColor: false },
  'xiaomi-token-plan-ams': { Icon: XiaomiMiMoIcon, hasColor: false },
  'xiaomi-token-plan-cn': { Icon: XiaomiMiMoIcon, hasColor: false },
  'xiaomi-token-plan-sgp': { Icon: XiaomiMiMoIcon, hasColor: false },
  zai: { Icon: ZAIIcon, hasColor: false },
  'zai-coding-cn': { Icon: ZAIIcon, hasColor: false },
  zhipu: { Icon: ZhipuColorIcon, hasColor: true },
  cohere: { Icon: CohereColorIcon, hasColor: true },
  perplexity: { Icon: PerplexityColorIcon, hasColor: true },
  together: { Icon: TogetherColorIcon, hasColor: true },
  grok: { Icon: GrokIcon, hasColor: false }
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

    return () => {
      const e = entry.value
      if (!e) {
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
        return h(e.Icon, { size: props.size })
      }
      return h(e.Icon, { size: props.size, style: { color: 'var(--el-text-color-secondary)' } })
    }
  }
})
