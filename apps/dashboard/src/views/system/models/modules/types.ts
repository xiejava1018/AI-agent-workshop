/**
 * modules/types.ts
 *
 * Views/system/models 视图层内部使用的状态类型。 跟 api/models-config.ts 的 Shape
 * 类型保持同步,不修改后端契约。
 */

// ----------------------------------------------------------------------------
// Constants
// ----------------------------------------------------------------------------

export const API_OPTIONS = [
  'openai-completions',
  'openai-responses',
  'anthropic-messages',
  'google-generative-ai'
] as const
export type ApiOption = (typeof API_OPTIONS)[number]

export const THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const
export type ThinkingLevel = (typeof THINKING_LEVELS)[number]

export const LEVEL_COLORS: Record<ThinkingLevel, string> = {
  off: 'var(--el-text-color-placeholder)',
  minimal: '#6b7280',
  low: '#60a5fa',
  medium: '#a78bfa',
  high: '#f472b6',
  xhigh: '#fb923c',
  max: '#ef4444'
}

export interface HeaderEntry {
  key: string
  value: string
}

// ----------------------------------------------------------------------------
// OAuth SSE state machine  (mirrors React ModelsConfig.tsx OAuthLoginState)
// ----------------------------------------------------------------------------

export type OAuthLoginState =
  | { phase: 'idle' }
  | { phase: 'connecting' }
  | {
      phase: 'auth'
      url: string
      instructions: string | null
      token: string
    }
  | {
      phase: 'device_code'
      userCode: string
      verificationUri: string
      intervalSeconds: number | null
      expiresInSeconds: number | null
    }
  | { phase: 'prompt'; message: string; placeholder: string | null; token: string }
  | {
      phase: 'select'
      message: string
      options: { id: string; label: string }[]
      token: string
    }
  | { phase: 'progress'; message: string }
  | { phase: 'success' }
  | { phase: 'error'; message: string }

// ----------------------------------------------------------------------------
// Model test state
// ----------------------------------------------------------------------------

export type TestState =
  | { phase: 'idle' }
  | { phase: 'testing' }
  | {
      phase: 'success'
      latencyMs?: number
      status?: number
      responseText?: string
    }
  | {
      phase: 'error'
      message: string
      latencyMs?: number
      status?: number
    }

// ----------------------------------------------------------------------------
// Page-level selection (which right-pane detail to render)
// ----------------------------------------------------------------------------

export type Selection =
  | { kind: 'none' }
  | { kind: 'oauth'; providerId: string }
  | { kind: 'apikey'; providerId: string }
  | { kind: 'provider'; name: string }
  | { kind: 'model'; name: string; modelId: string }
