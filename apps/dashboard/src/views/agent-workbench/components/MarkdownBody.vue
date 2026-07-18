<script setup lang="ts">
  /**
   * MarkdownBody — markdown 渲染 + DOMPurify 净化 + safeUrl 校验。
   *
   * 安全设计(参考 design v1.1 + v1.2 修订 §4-5):
   *   1. markdown-it 渲染 → DOMPurify.sanitize(html, { ALLOWED_TAGS, ALLOWED_ATTR })
   *      走白名单而非黑名单。
   *   2. 链接 href 二次校验:sanitize 后用 DOM walker 遍历 <a>,过 safeUrl(),
   *      失败则移除 href 属性(防 javascript: / data: URL 注入)。
   *   3. 不允许 <script> / <style> / <iframe> / on* 事件。
   *
   * 颜色方案:跟随 workbench.css 的 .wb-markdown 类(已预定义 p/code/pre/a/ul/ol)。
   */
  import { computed } from 'vue'
  import MarkdownIt from 'markdown-it'
  import DOMPurify from 'dompurify'

  interface Props {
    content: string
    mode?: 'full' | 'compact'
  }

  const props = withDefaults(defineProps<Props>(), {
    mode: 'full'
  })

  /** 允许的标签白名单 —— 比 markdown-it 默认输出稍紧 */
  const ALLOWED_TAGS = [
    'p',
    'br',
    'hr',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'strong',
    'em',
    'del',
    's',
    'u',
    'mark',
    'ul',
    'ol',
    'li',
    'a',
    'code',
    'pre',
    'kbd',
    'samp',
    'blockquote',
    'table',
    'thead',
    'tbody',
    'tr',
    'th',
    'td',
    'img'
  ]

  /** 允许的属性白名单 */
  const ALLOWED_ATTR = ['href', 'title', 'target', 'rel', 'src', 'alt']

  /** 允许的 URL scheme */
  const SAFE_URL_SCHEMES = new Set(['http:', 'https:', 'mailto:'])

  /** 校验 URL,失败返回 undefined(由调用方决定是否删除 href) */
  function safeUrl(url: string | null | undefined): string | undefined {
    if (!url) return undefined
    const trimmed = url.trim()
    if (!trimmed) return undefined
    try {
      const parsed = new URL(trimmed)
      if (SAFE_URL_SCHEMES.has(parsed.protocol)) return trimmed
      return undefined
    } catch {
      // 相对路径(不是合法 URL)— 在 web 工作台里只用于内部相对引用,
      // 这里为安全起见拒绝(渲染为无 href 文本)。
      return undefined
    }
  }

  const md = new MarkdownIt({
    html: false, // 禁止内嵌 HTML,避免 markdown 源直接携带 <script>
    linkify: true, // 自动识别 URL
    breaks: true, // \n 转 <br>
    typographer: false
  })

  /**
   * 安全渲染管线:
   *   markdown-it → DOMPurify → DOM walker 二次校验 href
   */
  function renderSafe(content: string): string {
    const raw = md.render(content ?? '')
    const sanitized = DOMPurify.sanitize(raw, {
      ALLOWED_TAGS,
      ALLOWED_ATTR,
      ALLOW_DATA_ATTR: false,
      FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form'],
      FORBID_ATTR: ['onerror', 'onclick', 'onload', 'onmouseover', 'onfocus', 'onblur']
    })

    // 二次校验:遍历 sanitized HTML 中的 <a> 与 <img>,把不安全的 href/src 移除
    if (typeof window === 'undefined' || !window.document) return sanitized
    const container = window.document.createElement('div')
    container.innerHTML = sanitized

    const anchors = container.querySelectorAll('a[href]')
    for (const a of Array.from(anchors)) {
      const href = a.getAttribute('href') ?? ''
      const safe = safeUrl(href)
      if (safe === undefined) {
        a.removeAttribute('href')
      } else {
        // 外部链接强制加 rel + target 安全属性
        if (a.getAttribute('target') === '_blank' && !a.getAttribute('rel')) {
          a.setAttribute('rel', 'noopener noreferrer')
        }
      }
    }

    const imgs = container.querySelectorAll('img[src]')
    for (const img of Array.from(imgs)) {
      const src = img.getAttribute('src') ?? ''
      const safe = safeUrl(src)
      if (safe === undefined) {
        img.removeAttribute('src')
      }
    }

    return container.innerHTML
  }

  const safeHtml = computed(() => renderSafe(props.content))
</script>

<template>
  <div
    class="wb-markdown"
    :class="{ 'wb-markdown--compact': props.mode === 'compact' }"
    v-html="safeHtml"
  />
</template>

<style scoped>
  .wb-markdown--compact {
    font-size: 13px;
    line-height: 1.5;
  }

  .wb-markdown--compact pre,
  .wb-markdown--compact :deep(pre) {
    font-size: 11.5px;
  }
</style>
