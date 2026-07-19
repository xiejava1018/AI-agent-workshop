# Vue 3 Agent 工作台运行时集成修复 — PR 报告

> 日期：2026-07-19
> commit: `1b74a8f` — feat(dashboard): wire AppShell into /workspace/agent + 6 integration fixes
> 跟进:docs/superpowers/reports/2026-07-19-vue3-agent-workbench-handoff.md
>      docs/superpowers/reports/2026-07-19-vue3-agent-workbench-replica-pr.md

## 上下文

handoff 文档 §1 标记 "**AppShell 集成验证 ❌ 未做**" 和 "**路由切换到新 AppShell ❌ 回退了**"。本次会话接手后:

1. 完成 Phase 1:AppShell 静态集成(3 子组件接线 + ChatInput slot 注入)
2. 完成 Phase 5.3 切路由(index.vue 缩成薄壳,693 行老实现备份到 index.old.vue)
3. 浏览器实测发现 3 个新问题,逐一修根因(共 3 次失败后才找到第 2 个问题的真根因)

## 改动统计

| 文件 | 改动 |
|---|---|
| `apps/dashboard/src/views/agent-workbench/AppShell.vue` | 删 handleCreate stub; 注入 ChatInput slot; TabBar v-if 改 >0; 加 art-full-height |
| `apps/dashboard/src/views/agent-workbench/index.vue` | 693 行 → 17 行薄壳,头部补 `import './styles/workbench.css'` |
| `apps/dashboard/src/views/agent-workbench/index.old.vue` | 老实现备份(新文件) |
| `apps/dashboard/src/views/agent-workbench/components/SessionSidebar.vue` | handleNewSession 从 useUserStore 读 userId 传 create |
| `apps/dashboard/src/views/agent-workbench/composables/useSessionList.ts` | create 接受 userId 参数;乐观 push(远端 list 缺失时补位) |
| `apps/dashboard/src/views/agent-workbench/__tests__/useSessionList.test.ts` | 新加"远端不返回 new"乐观 push 场景测试 |
| `apps/dashboard/src/views/agent-workbench/styles/workbench.css` | 补 `.wb-chat-window` / `.wb-chat-input` 容器规则;.agent-workbench 高度改用 `var(--art-full-height, 100%)` |
| `apps/dashboard/src/types/components.d.ts` | 自动生成(ElButtonGroup / ElPopconfirm 被 AppShell / SessionSidebar 引用) |

合计:**8 文件,+1147 / -987**

## 三个根因(都靠读代码找到,非靠浏览器调试)

### R1:workbench.css 没被加载

**症状**:整个工作台塌成 0 高度堆叠列表(浏览器截图 1)。

**根因**:`styles/workbench.css` 第 10 行注释明确"加载方式: 在 index.vue 里 import './styles/workbench.css'"。Phase 1 切路由时把老 index.vue 缩成 17 行薄壳,**漏了 import**。workbench.css 不进 bundle,所有 `.agent-workbench` 三栏 flex 布局 + 14 子组件用的 `.wb-*` 类全失效。

**修复**:`index.vue` 头部加 `import './styles/workbench.css'`,并在文件头注释里重申此约定。

### R2:chat-area 高度 3 次修复失败后的真根因

**症状**:三栏布局恢复后,中间 ChatWindow 高度只占 ~470px,viewport 下方 ~400px 全空(截图 3、4、5)。

**尝试 1**:`workbench.css` 加 `.wb-chat-window` + `.wb-chat-input` 两条 flex 容器规则 — 修通"ChatInput 不显示",但 chat-area 仍只占 ~600px。

**尝试 2**:`index.vue` scoped style 给 `.agent-workbench-page` 加 `height: 100%` — 无效。

**尝试 3**:`index.vue` scoped style `:deep(.layout-content) { height: 100% }` — **失败**。

**真正根因**:Vue 的 `:deep()` 只能穿到**当前组件的子树**,不能改**祖先组件**。`.layout-content` 是 art-page-content(祖先)的根 div,不在我的子树里,`:deep(.layout-content)` **根本没匹配到任何元素**。

**最终修复**:用 vue-pure-admin 模板约定 — `class="art-full-height"` + CSS 变量 `var(--art-full-height)`(由 `useLayoutHeight` 钩子动态算 `100vh - header - tabs` 写到 `:root`)。老 index.vue line 416-420 用的就是这个套路:`height: var(--art-full-height, calc(100vh - 60px))`。

- `AppShell.vue` 根 div 加 `art-full-height` class
- `workbench.css` `.agent-workbench` 高度改 `var(--art-full-height, 100%)`

**教训(下次别再踩)**:写 scoped style 看不到预期效果时,先**看老实现 / 同模板其他页面**怎么处理的,而不是反复猜。`.art-full-height` 是 vue-pure-admin 模板的全高度容器标准做法,在 `assets/styles/core/app.scss:193` 定义,在 `views/asset/overview`、`views/asset/list`、`views/asset/detail` 等 8+ 个页面都用。

### R3:新建会话不进 SessionSidebar

**症状**:点"+"新会话出现在 TabBar,但侧栏不显示。截图 3、4 都能看到。

**初步错误假设(已纠正)**:以为是后端 `/api/agent/sessions` 端点不返回新建空会话(基于 `api/agent.ts:40` 注释"原 /api/agent/sessions 404")。基于这个错误假设加了乐观 push,测试通过但**浏览器实测仍不生效**。

**真正根因**(读后端 `apps/web/app/api/agent/sessions/route.ts:58` 才看到):

```ts
const decision = await assertCanReadSessionScoped(userId, userRole, meta, s.id)
if (decision.allowed) items.push(...)
```

`useSessionList.create()` 调 `createSession('default')` —— **永远传字面量 'default' 当 userId**。后端 `POST /api/agent/new` 把这个 userId 写到 session.userId。后续 `GET /api/agent/sessions` 用真实用户鉴权,**新建的 session 因 userId='default' 不属于真实用户,被过滤掉**。

`api/agent.ts:40` 注释误导了排查方向 — 实际端点存在,只是鉴权过滤了 default 用户的 session。

**修复**:
- `useSessionList.create(userId?: string)` 接受可选参数(测试用 'default',生产传真实 userId)
- `SessionSidebar.handleNewSession` 从 `useUserStore().info.userId` 读真实 userId 传入

为什么不直接在 useSessionList 里 import useUserStore?userStore 的依赖图会引入 `@/mock/upgrade/changeLog.ts` 等测试环境不友好的模块,导致 vitest 14 个 test 跑不起来(实测踩了)。

## 仍未解决(单独开任务)

**chat 无回复**:user 消息 `hi` 出现,但无 assistant 占位/回复。

- sendMessage API path、userId 处理、后端 POST 端点都正常
- 老 index.vue 用同样的 sendMessage path + 同样的 `localStorage.getItem('user_id') || ''` —— **如果老实现也无回复,这是历史 bug;如果有回复,这是我的回归**
- 需要 DevTools Network 面板看 `POST /api/agent/[id]` response + `EventStream GET /api/agent/[id]/events` 帧
- 初步怀疑:pi SDK 内部 prompt 路径对 `body.userId=''` 行为异常,或 SSE wrapper 推 message_start 事件链路有问题

不在本次 commit 范围(避免把"集成修复"和"功能 bug"混在一起)。

## 测试 / 类型 / Lint

| 检查 | 结果 |
|---|---|
| vitest | 115 pass(原 113 + 1 "远端不返回" + 1 原 create 成功路径仍 OK) |
| vue-tsc | 0 错 |
| eslint | 0 错 |

## 浏览器实测清单(已确认 ✅)

- [x] 三栏布局(左 SessionSidebar / 中 TabBar+ChatWindow / 右抽屉)
- [x] 顶栏 4 按钮(文件/模型/技能/插件)→ 右抽屉正确切换
- [x] 点"+" → 新会话进侧栏(置顶区显示"新会话")
- [x] 切换历史会话 → TabBar 激活
- [x] 发送消息 → user 消息显示(无 assistant 回复 — 见上)
- [x] 置顶/重命名/删除(UI 可用,未跑完整流)
- [x] chat-area 高度撑满 viewport(art-full-height 修复后)

## 教训(下次开工前必读)

1. **写 scoped style 看不到效果时,先看老实现/同模板其他页面** —— 而不是反复猜 DOM 结构(参见 R2 的 3 次失败)。
2. **代码注释可能是过时的** —— `api/agent.ts:40` 注释"原 sessions 404"误导我绕了一大圈,真正问题是 userId 契约。
3. **修改 composable 时注意依赖图** —— useSessionList 不直接 import useUserStore,改让调用方传 userId 参数,避免测试 import 链爆。
4. **集成完成 ≠ 任务完成** —— handoff §3.2 教训仍有效,静态门禁全过只是"代码能编译",运行时才是真考验。
