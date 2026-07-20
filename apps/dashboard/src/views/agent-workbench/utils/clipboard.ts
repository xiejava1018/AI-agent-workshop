/**
 * 跨浏览器复制工具 —— 优先 navigator.clipboard,降级到临时 textarea + execCommand。
 *
 * 返回 true 表示复制成功,false 表示失败(由调用方决定是否 ElNotification 提示)。
 * 注意:navigator.clipboard 在非 secure context (http://) 或隐身模式下可能不可用,
 * 因此 textarea fallback 永远保留。
 */
export async function copyText(text: string): Promise<boolean> {
  if (!text) return false
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    /* 落到 textarea fallback */
  }
  try {
    if (typeof document === 'undefined') return false
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.left = '-9999px'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch {
    return false
  }
}