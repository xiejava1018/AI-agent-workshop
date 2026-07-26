<!--
  modules/OAuthDetail.vue
  OAuth 提供方登录/断开/状态机。 复刻 React ModelsConfig.tsx OAuthDetail 的 8-phase 状态机
  + EventSource + 三处 cleanup(onUnmounted/provider.id watch/terminal SSE case)。

  用 ElMessage 提示成功/失败;不弹自定义 dialog。
-->
<template>
  <div class="oauth-detail">
    <header class="oauth-detail__header">
      <h3 class="oauth-detail__title">{{ provider.name }} · 订阅</h3>
      <div class="oauth-detail__status">
        <span
          class="oauth-detail__dot"
          :style="{ background: provider.loggedIn ? '#4ade80' : 'var(--el-border-color)' }"
        />
        <span :class="provider.loggedIn ? 'oauth-detail__ok' : 'oauth-detail__muted'">
          {{ provider.loggedIn ? '已连接' : '未连接' }}
        </span>
      </div>
    </header>

    <!-- 状态展示 -->
    <div class="oauth-detail__state">
      <template v-if="state.phase === 'idle'">
        <p class="oauth-detail__msg">
          {{
            provider.loggedIn ? '已连接。 可重新登录或断开。' : `连接你的 ${provider.name} 账号。`
          }}
        </p>
      </template>

      <template v-else-if="state.phase === 'connecting'">
        <p class="oauth-detail__msg">正在开启登录流程…</p>
      </template>

      <template v-else-if="state.phase === 'auth'">
        <p class="oauth-detail__msg">
          请在浏览器中完成登录,然后把浏览器地址栏里的完整回调 URL 粘贴到下方输入框。
        </p>
        <p class="oauth-detail__hint">
          浏览器没自动打开?
          <a :href="state.url" target="_blank" rel="noopener noreferrer">点此打开登录页</a>
        </p>
        <div class="oauth-detail__input-row">
          <ElInput
            v-model="inputValue"
            placeholder="http://localhost:1455/auth/callback?code=…"
            @keyup.enter="onSubmitCode"
          />
          <ElButton type="primary" :disabled="!inputValue.trim()" @click="onSubmitCode"
            >提交</ElButton
          >
        </div>
      </template>

      <template v-else-if="state.phase === 'device_code'">
        <p class="oauth-detail__msg"> 在打开的验证页面输入下面的用户码: </p>
        <div class="oauth-detail__code">{{ state.userCode }}</div>
        <p class="oauth-detail__hint">
          <a :href="state.verificationUri" target="_blank" rel="noopener noreferrer">
            {{ state.verificationUri }}
          </a>
          <span v-if="state.expiresInSeconds">
            · 剩余 {{ Math.ceil(state.expiresInSeconds / 60) }} 分钟</span
          >
        </p>
      </template>

      <template v-else-if="state.phase === 'select'">
        <p class="oauth-detail__msg">{{ state.message }}</p>
        <div class="oauth-detail__select-list">
          <ElButton
            v-for="opt in state.options"
            :key="opt.id"
            class="oauth-detail__select-item"
            @click="onSubmitSelection(state.token, opt.id)"
            >{{ opt.label }}</ElButton
          >
        </div>
      </template>

      <template v-else-if="state.phase === 'prompt'">
        <p class="oauth-detail__msg">{{ state.message }}</p>
        <div class="oauth-detail__input-row">
          <ElInput
            v-model="inputValue"
            :placeholder="state.placeholder ?? '输入…'"
            @keyup.enter="onSubmitCode"
          />
          <ElButton type="primary" :disabled="!inputValue.trim()" @click="onSubmitCode"
            >提交</ElButton
          >
        </div>
      </template>

      <template v-else-if="state.phase === 'progress'">
        <p class="oauth-detail__msg">{{ state.message }}</p>
      </template>

      <template v-else-if="state.phase === 'success'">
        <p class="oauth-detail__msg oauth-detail__msg--ok">已成功连接。</p>
      </template>

      <template v-else-if="state.phase === 'error'">
        <p class="oauth-detail__msg oauth-detail__msg--err">{{ state.message }}</p>
      </template>
    </div>

    <!-- 操作按钮 -->
    <div class="oauth-detail__actions">
      <template v-if="isWorking">
        <ElButton @click="cancel">取消</ElButton>
      </template>
      <template v-else>
        <ElButton type="primary" @click="handleLogin">{{
          provider.loggedIn ? '重新登录' : '登录'
        }}</ElButton>
        <ElButton v-if="provider.loggedIn" type="danger" plain @click="handleLogout">断开</ElButton>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
  import { computed, onUnmounted, ref, watch } from 'vue'
  import { ElMessage } from 'element-plus'
  import type { OAuthProviderShape } from '@/api/models-config'
  import { logoutOAuth, submitOAuthCode } from '@/api/models-config'
  import type { OAuthLoginState } from './types'

  const props = defineProps<{
    provider: OAuthProviderShape
  }>()
  const emit = defineEmits<{ refresh: [] }>()

  const state = ref<OAuthLoginState>({ phase: 'idle' })
  const inputValue = ref('')
  let es: EventSource | null = null
  let countdownId: ReturnType<typeof setInterval> | undefined

  const isWorking = computed(
    () =>
      state.value.phase === 'connecting' ||
      state.value.phase === 'auth' ||
      state.value.phase === 'device_code' ||
      state.value.phase === 'prompt' ||
      state.value.phase === 'select' ||
      state.value.phase === 'progress'
  )

  // --------------------------------------------------------------------------
  // Cleanup (3 处都必须 close): onUnmounted, provider.id watch, terminal SSE
  // --------------------------------------------------------------------------

  function closeEventSource(): void {
    if (es) {
      es.close()
      es = null
    }
  }

  function clearCountdown(): void {
    if (countdownId !== undefined) {
      clearInterval(countdownId)
      countdownId = undefined
    }
  }

  onUnmounted(() => {
    closeEventSource()
    clearCountdown()
  })

  watch(
    () => props.provider.id,
    () => {
      closeEventSource()
      clearCountdown()
      state.value = { phase: 'idle' }
      inputValue.value = ''
    }
  )

  // device_code 倒计时
  watch(
    () => state.value.phase,
    (phase) => {
      clearCountdown()
      if (phase === 'device_code' && 'expiresInSeconds' in state.value) {
        let remaining = state.value.expiresInSeconds ?? 0
        if (remaining <= 0) return
        countdownId = setInterval(() => {
          remaining -= 1
          if (remaining <= 0) {
            const cur = state.value
            if (cur.phase === 'device_code') {
              state.value = { ...cur, expiresInSeconds: 0 }
            }
            clearCountdown()
            return
          }
          const cur = state.value
          if (cur.phase === 'device_code') {
            state.value = { ...cur, expiresInSeconds: remaining }
          }
        }, 1000)
      }
    }
  )

  // --------------------------------------------------------------------------
  // EventSource flow
  // --------------------------------------------------------------------------

  interface InboundMessage {
    type: string
    url?: string
    instructions?: string | null
    token?: string
    message?: string
    placeholder?: string | null
    userCode?: string
    verificationUri?: string
    intervalSeconds?: number | null
    expiresInSeconds?: number | null
    options?: { id: string; label: string }[]
  }

  function handleLogin(): void {
    closeEventSource()
    inputValue.value = ''
    state.value = { phase: 'connecting' }

    es = new EventSource(`/api/auth/login/${encodeURIComponent(props.provider.id)}`)

    es.onmessage = (e: MessageEvent) => {
      let data: InboundMessage
      try {
        data = JSON.parse(e.data) as InboundMessage
      } catch {
        return
      }
      switch (data.type) {
        case 'auth':
          if (data.url && data.token) {
            state.value = {
              phase: 'auth',
              url: data.url,
              instructions: data.instructions ?? null,
              token: data.token
            }
            window.open(data.url, '_blank', 'noopener,noreferrer')
          }
          break
        case 'device_code':
          if (data.userCode && data.verificationUri) {
            state.value = {
              phase: 'device_code',
              userCode: data.userCode,
              verificationUri: data.verificationUri,
              intervalSeconds: data.intervalSeconds ?? null,
              expiresInSeconds: data.expiresInSeconds ?? null
            }
            window.open(data.verificationUri, '_blank', 'noopener,noreferrer')
          }
          break
        case 'prompt_request':
          if (data.message && data.token) {
            state.value = {
              phase: 'prompt',
              message: data.message,
              placeholder: data.placeholder ?? null,
              token: data.token
            }
          }
          break
        case 'select_request':
          if (data.message && data.token && data.options) {
            state.value = {
              phase: 'select',
              message: data.message,
              options: data.options,
              token: data.token
            }
          }
          break
        case 'progress':
          if (data.message) state.value = { phase: 'progress', message: data.message }
          break
        case 'success':
          closeEventSource()
          state.value = { phase: 'success' }
          emit('refresh')
          ElMessage.success('已连接')
          break
        case 'error':
          closeEventSource()
          state.value = {
            phase: 'error',
            message: data.message ?? '未知错误'
          }
          break
        case 'cancelled':
          closeEventSource()
          state.value = { phase: 'idle' }
          break
      }
    }

    es.onerror = () => {
      if (state.value.phase !== 'success') {
        closeEventSource()
        state.value = { phase: 'error', message: '连接已断开' }
      }
    }
  }

  function cancel(): void {
    closeEventSource()
    state.value = { phase: 'idle' }
  }

  // --------------------------------------------------------------------------
  // Submit paths
  // --------------------------------------------------------------------------

  async function onSubmitCode(): Promise<void> {
    const code = inputValue.value.trim()
    if (!code) return
    const cur = state.value
    const token = 'token' in cur ? cur.token : undefined
    if (!token) return
    state.value = { phase: 'progress', message: '验证中…' }
    try {
      const r = await submitOAuthCode(props.provider.id, token, code)
      if (!r.ok) {
        state.value = {
          phase: 'error',
          message: r.error ?? '验证失败'
        }
      }
      // success path will arrive via SSE event
    } catch (e) {
      state.value = {
        phase: 'error',
        message: e instanceof Error ? e.message : String(e)
      }
    }
  }

  async function onSubmitSelection(token: string, value: string): Promise<void> {
    state.value = { phase: 'progress', message: '提交选项中…' }
    try {
      // React 也用 submitOAuthCode 提交 select 选项 id 当作 code
      const r = await submitOAuthCode(props.provider.id, token, value)
      if (!r.ok) {
        state.value = { phase: 'error', message: r.error ?? '提交失败' }
      }
    } catch (e) {
      state.value = {
        phase: 'error',
        message: e instanceof Error ? e.message : String(e)
      }
    }
  }

  async function handleLogout(): Promise<void> {
    try {
      await logoutOAuth(props.provider.id)
      state.value = { phase: 'idle' }
      ElMessage.success('已断开')
      emit('refresh')
    } catch (e) {
      ElMessage.error('断开失败: ' + (e instanceof Error ? e.message : String(e)))
    }
  }
</script>

<style lang="scss" scoped>
  .oauth-detail {
    &__header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 12px;
    }
    &__title {
      font-size: 13px;
      font-weight: 600;
      margin: 0;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--el-text-color-secondary);
    }
    &__status {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    &__dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      display: inline-block;
    }
    &__ok {
      font-size: 11px;
      color: #4ade80;
    }
    &__muted {
      font-size: 11px;
      color: var(--el-text-color-placeholder);
    }
    &__state {
      min-height: 96px;
      margin-bottom: 16px;
    }
    &__msg {
      margin: 0 0 8px;
      font-size: 13px;
      line-height: 1.5;
      color: var(--el-text-color-regular);
      &--ok {
        color: #4ade80;
      }
      &--err {
        color: var(--el-color-danger);
      }
    }
    &__hint {
      margin: 0 0 8px;
      font-size: 12px;
      color: var(--el-text-color-placeholder);
    }
    &__code {
      padding: 8px 12px;
      background: var(--el-fill-color);
      border: 1px solid var(--el-border-color-light);
      border-radius: 4px;
      color: var(--el-text-color-primary);
      font-size: 16px;
      font-weight: 700;
      font-family: var(--el-font-family-monospace, monospace);
      margin-bottom: 8px;
      letter-spacing: 0;
      text-align: center;
    }
    &__input-row {
      display: flex;
      gap: 6px;
      margin-top: 8px;
    }
    &__select-list {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    &__select-item {
      justify-content: flex-start;
      text-align: left;
    }
    &__actions {
      display: flex;
      gap: 8px;
    }
  }
</style>
