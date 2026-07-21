// 模型配置页面 e2e 冒烟测试（使用系统 Chrome）
// 运行：node e2e-model-config.mjs   （需先启动 web 后端 30141 与 dashboard 5174）
import { chromium } from '@playwright/test'

const DASHBOARD = process.env.E2E_BASE || 'http://localhost:5174'
const results = []
function check(name, ok, detail = '') {
  results.push({ name, ok, detail })
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`)
}

const browser = await chromium.launch({
  // 复用系统 Chrome，避免下载 Playwright 自带浏览器二进制
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
})
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await context.newPage()
const reqLog = []
page.on('request', (r) => {
  if (r.url().includes('/api/')) reqLog.push(`${r.method()} ${r.url()}`)
})
page.on('response', (r) => {
  if (r.url().includes('/api/models-config') || r.url().includes('/api/auth/')) {
    reqLog.push(`  <- ${r.status()} ${r.url()}`)
  }
})

try {
  // 1. 打开并登录(直跳登录页避免初始 / 的递归重定向)
  await page.goto(`${DASHBOARD}/#/auth/login`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(2000)

  // 落在登录页则登录
  const userInput = page.locator('input[placeholder*="账号"], input[placeholder*="用户"], input[type="text"]').first()
  if (await userInput.count()) {
    await userInput.fill('root')
    await page.locator('input[type="password"]').first().fill('Test1234!')
    await page.getByRole('button', { name: /登录|登 录|Login/i }).first().click()
    await page.waitForTimeout(4000)
  }
  check('登录后到达工作台', page.url().includes('dashboard') || page.url().includes('console') || page.url().includes('workspace'), page.url())

  // 2. 直达模型配置页
  await page.goto(`${DASHBOARD}/#/admin/models`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(2500)

  const titleVisible = await page.getByText('模型配置').first().isVisible().catch(() => false)
  check('模型配置页标题可见', titleVisible)

  const pathVisible = await page.getByText('models.json').first().isVisible().catch(() => false)
  check('显示配置文件路径', pathVisible)

  // 3. 校验已加载供应商树（来自后端 my-test + auth/* providers）
  const myTestVisible = await page.getByText('my-test').first().isVisible().catch(() => false)
  check('已加载自定义供应商 my-test', myTestVisible)

  const gptModelVisible = await page.getByText('gpt-4o-mini').first().isVisible().catch(() => false)
  check('已加载模型 gpt-4o-mini', gptModelVisible)

  // 4. 点击 my-test 供应商，确认详情面板渲染
  await page.getByText('my-test').first().click()
  await page.waitForTimeout(800)
  const baseUrlLabel = await page.getByText('Base URL').first().isVisible().catch(() => false)
  check('供应商详情面板渲染（Base URL）', baseUrlLabel)
  const apiValVisible = await page.getByText('openai-completions').first().isVisible().catch(() => false)
  check('供应商 API 协议显示', apiValVisible)

  // 5. 点击模型，确认模型详情 + 测试按钮渲染
  await page.getByText('gpt-4o-mini').first().click()
  await page.waitForTimeout(800)
  const testBtn = page.getByRole('button', { name: '测试' }).first()
  const testVisible = await testBtn.isVisible().catch(() => false)
  check('模型详情面板渲染（测试按钮）', testVisible)

  // 6. 添加新供应商
  await page.getByRole('button', { name: '添加供应商' }).first().click()
  await page.waitForTimeout(800)
  const pickerVisible = await page.getByText('自定义供应商').first().isVisible().catch(() => false)
  check('添加供应商弹窗打开', pickerVisible)
  await page.getByRole('button', { name: /新建自定义供应商/ }).first().click()
  await page.waitForTimeout(800)
  const newProviderVisible = await page.getByText('new-provider').first().isVisible().catch(() => false)
  check('新建自定义供应商成功', newProviderVisible)

  // 7. 保存
  await page.getByRole('button', { name: '保存' }).first().click()
  await page.waitForTimeout(1500)
  const saved = await page.getByText('保存成功').first().isVisible().catch(() => false)
  check('保存配置成功', saved)

  console.log('\n--- API 请求记录（模型配置相关）---')
  reqLog.slice(-20).forEach((l) => console.log(l))
} catch (e) {
  check('测试执行', false, e.message)
} finally {
  await page.screenshot({ path: 'e2e-model-config.png', fullPage: true }).catch(() => {})
  await browser.close()
}

const failed = results.filter((r) => !r.ok)
console.log(`\n==== 结果：${results.length - failed.length}/${results.length} 通过 ====`)
process.exit(failed.length ? 1 : 0)
