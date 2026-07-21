<template>
  <div class="detail">
    <div class="detail-head">
      <span class="section-title">订阅</span>
      <div class="status">
        <span class="dot" :class="{ on: provider.loggedIn }" />
        <span :class="{ ok: provider.loggedIn }">{{
          provider.loggedIn ? '已连接' : '未连接'
        }}</span>
      </div>
    </div>

    <div class="status-area">
      <!-- idle -->
      <p v-if="loginState.phase === 'idle'" class="muted">
        {{ provider.loggedIn ? '已连接。可重新登录或断开。' : `连接你的 ${provider.name} 账户。` }}
      </p>

      <p v-else-if="loginState.phase === 'connecting'" class="muted">正在打开浏览器…</p>
      <p v-else-if="loginState.phase === 'progress'" class="muted">{{ loginState.message }}</p>
      <p v-else-if="loginState.phase === 'success'" class="ok">连接成功。</p>
      <p v-else-if="loginState.phase === 'error'" class="err">{{ loginState.message }}</p>

      <!-- select -->
      <div v-else-if="loginState.phase === 'select'" class="col">
        <p class="muted">{{ loginState.message }}</p>
        <div class="select-list">
          <button
            v-for="opt in loginState.options"
            :key="opt.id"
            class="select-opt"
            @click="submitSelection(loginState.token, opt.id)"
          >
            {{ opt.label }}
          </button>
        </div>
      </div>

      <!-- auth / prompt -->
      <div v-else-if="loginState.phase === 'auth' || loginState.phase === 'prompt'" class="col">
        <p class="muted">
          {{
            loginState.phase === 'auth'
              ? '在浏览器中完成登录后，复制地址栏的跳转 URL 并粘贴到下方。'
              : loginState.message
          }}
        </p>
        <p v-if="loginState.phase === 'auth'" class="hint">
          若浏览器未自动打开，
          <a :href="loginState.url" target="_blank" rel="noopener noreferrer">点此打开登录页</a>。
        </p>
        <div class="code-row">
          <ElInput
            v-model="inputValue"
            :placeholder="
              loginState.phase === 'auth'
                ? 'http://localhost:1455/auth/callback?code=…'
                : (loginState.placeholder ?? '请输入…')
            "
            class="font-mono"
            @keydown.enter="submitCode(loginState.token, inputValue)"
          />
          <ElButton
            type="primary"
            :disabled="!inputValue.trim()"
            @click="submitCode(loginState.token, inputValue)"
            >提交</ElButton
          >
        </div>
      </div>

      <!-- device_code -->
      <div v-else-if="loginState.phase === 'device_code'" class="col">
        <p class="muted">打开验证页并输入以下代码：</p>
        <div class="user-code">{{ loginState.userCode }}</div>
        <p class="hint">
          <a :href="loginState.verificationUri" target="_blank" rel="noopener noreferrer">{{
            loginState.verificationUri
          }}</a>
          <template v-if="loginState.expiresInSeconds">
            约 {{ Math.ceil(loginState.expiresInSeconds / 60) }} 分钟后过期。</template
          >
        </p>
      </div>
    </div>

    <div class="actions">
      <template v-if="isWorking">
        <ElButton @click="cancel">取消</ElButton>
      </template>
      <template v-else>
        <ElButton type="primary" @click="handleLogin">{{
          provider.loggedIn ? '重新登录' : '登录'
        }}</ElButton>
        <ElButton v-if="provider.loggedIn" plain class="danger-btn" @click="handleLogout"
          >断开</ElButton
        >
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
  import { ref, computed, onUnmounted, watch } from 'vue'
  import {
    logoutOAuth,
    submitOAuthCode,
    oauthLoginStreamUrl,
    type OAuthProvider
  } from '@/api/models-config'

  const props = defineProps<{ provider: OAuthProvider }>()
  const emit = defineEmits<{ refresh: [] }>()

  type LoginState =
    | { phase: 'idle' }
    | { phase: 'connecting' }
    | { phase: 'auth'; url: string; instructions: string | null; token: string }
    | {
        phase: 'device_code'
        userCode: string
        verificationUri: string
        intervalSeconds: number | null
        expiresInSeconds: number | null
      }
    | { phase: 'prompt'; message: string; placeholder: string | null; token: string }
    | { phase: 'select'; message: string; options: { id: string; label: string }[]; token: string }
    | { phase: 'progress'; message: string }
    | { phase: 'success' }
    | { phase: 'error'; message: string }

  const loginState = ref<LoginState>({ phase: 'idle' })
  const inputValue = ref('')
  let es: EventSource | null = null

  const isWorking = computed(() =>
    ['connecting', 'progress', 'auth', 'device_code', 'prompt', 'select'].includes(
      loginState.value.phase
    )
  )

  function closeStream() {
    es?.close()
    es = null
  }

  watch(
    () => props.provider.id,
    () => {
      loginState.value = { phase: 'idle' }
      inputValue.value = ''
      closeStream()
    }
  )

  onUnmounted(closeStream)

  function handleLogin() {
    closeStream()
    loginState.value = { phase: 'connecting' }
    inputValue.value = ''

    const stream = new EventSource(oauthLoginStreamUrl(props.provider.id))
    es = stream

    stream.onmessage = (e) => {
      const data = JSON.parse(e.data) as {
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
      switch (data.type) {
        case 'auth':
          loginState.value = {
            phase: 'auth',
            url: data.url!,
            instructions: data.instructions ?? null,
            token: data.token!
          }
          window.open(data.url!, '_blank', 'noopener,noreferrer')
          break
        case 'device_code':
          loginState.value = {
            phase: 'device_code',
            userCode: data.userCode!,
            verificationUri: data.verificationUri!,
            intervalSeconds: data.intervalSeconds ?? null,
            expiresInSeconds: data.expiresInSeconds ?? null
          }
          window.open(data.verificationUri!, '_blank', 'noopener,noreferrer')
          break
        case 'prompt_request':
          loginState.value = {
            phase: 'prompt',
            message: data.message!,
            placeholder: data.placeholder ?? null,
            token: data.token!
          }
          break
        case 'select_request':
          loginState.value = {
            phase: 'select',
            message: data.message!,
            options: data.options ?? [],
            token: data.token!
          }
          break
        case 'progress':
          loginState.value = { phase: 'progress', message: data.message! }
          break
        case 'success':
          stream.close()
          loginState.value = { phase: 'success' }
          emit('refresh')
          break
        case 'error':
          stream.close()
          loginState.value = { phase: 'error', message: data.message! }
          break
        case 'cancelled':
          stream.close()
          loginState.value = { phase: 'idle' }
          break
      }
    }
    stream.onerror = () => {
      stream.close()
      loginState.value =
        loginState.value.phase === 'success'
          ? loginState.value
          : { phase: 'error', message: '连接中断' }
    }
  }

  function cancel() {
    closeStream()
    loginState.value = { phase: 'idle' }
  }

  async function handleLogout() {
    await logoutOAuth(props.provider.id)
    loginState.value = { phase: 'idle' }
    emit('refresh')
  }

  async function submitCode(token: string, code: string) {
    if (!code.trim()) return
    loginState.value = { phase: 'progress', message: '验证中…' }
    try {
      const res = await submitOAuthCode(props.provider.id, token, code)
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        loginState.value = {
          phase: 'error',
          message: (d as { error?: string }).error ?? `服务器错误 ${res.status}`
        }
        return
      }
      inputValue.value = ''
      // 成功路径由 SSE 推送 success 事件更新状态
    } catch (e: unknown) {
      loginState.value = { phase: 'error', message: e instanceof Error ? e.message : '网络错误' }
    }
  }

  async function submitSelection(token: string, value: string) {
    loginState.value = { phase: 'progress', message: '继续中…' }
    try {
      const res = await submitOAuthCode(props.provider.id, token, value)
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        loginState.value = {
          phase: 'error',
          message: (d as { error?: string }).error ?? `服务器错误 ${res.status}`
        }
      }
    } catch (e: unknown) {
      loginState.value = { phase: 'error', message: e instanceof Error ? e.message : '网络错误' }
    }
  }
</script>

<style scoped>
  .detail {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .detail-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .section-title {
    font-size: 11px;
    font-weight: 600;
    color: var(--el-text-color-secondary);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }

  .status {
    display: flex;
    gap: 6px;
    align-items: center;
    font-size: 11px;
    color: var(--el-text-color-placeholder);
  }

  .status .ok {
    color: #4ade80;
  }

  .dot {
    display: inline-block;
    width: 7px;
    height: 7px;
    background: var(--el-border-color);
    border-radius: 50%;
  }

  .dot.on {
    background: #4ade80;
  }

  .status-area {
    min-height: 48px;
  }

  .muted {
    margin: 0;
    font-size: 12px;
    line-height: 1.5;
    color: var(--el-text-color-regular);
  }

  .ok {
    margin: 0;
    font-size: 12px;
    color: #4ade80;
  }

  .err {
    margin: 0;
    font-size: 12px;
    color: var(--el-color-danger);
  }

  .hint {
    margin: 0;
    font-size: 11px;
    line-height: 1.5;
    color: var(--el-text-color-placeholder);
    word-break: break-all;
  }

  .hint a {
    color: var(--el-color-primary);
  }

  .col {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .code-row {
    display: flex;
    gap: 6px;
    width: 100%;
  }

  .code-row .el-input {
    flex: 1;
  }

  .select-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .select-opt {
    padding: 6px 9px;
    font-size: 12px;
    color: var(--el-text-color-primary);
    text-align: left;
    cursor: pointer;
    background: var(--el-bg-color);
    border: 1px solid var(--el-border-color);
    border-radius: 5px;
  }

  .select-opt:hover {
    border-color: var(--el-color-primary);
  }

  .user-code {
    padding: 8px 10px;
    font-family: var(--el-font-family-mono, ui-monospace, monospace);
    font-size: 16px;
    font-weight: 700;
    background: var(--el-bg-color);
    border: 1px solid var(--el-border-color);
    border-radius: 5px;
  }

  .actions {
    display: flex;
    gap: 8px;
  }

  .font-mono :deep(input) {
    font-family: var(--el-font-family-mono, ui-monospace, monospace);
  }

  .danger-btn {
    color: var(--el-color-danger);
    border-color: var(--el-color-danger-light-5);
  }

  .danger-btn:hover {
    background: var(--el-color-danger-light-9);
  }
</style>
