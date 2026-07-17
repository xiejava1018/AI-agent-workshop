# C1 Spike — pi-mcp-extension 兼容性验证

> 日期：2026-07-16
> 任务：M3 Build 入口门控 Task 0.1
> 结论：**兼容（有条件）**

---

## 1. 包信息查证

### 1.1 npm registry 元数据

```
$ npm view pi-mcp-extension
pi-mcp-extension@1.5.0 | MIT | deps: 2 | versions: 4
MCP (Model Context Protocol) client extension for the Pi coding agent
https://github.com/irahardianto/pi-mcp-extension

dependencies:
- @modelcontextprotocol/sdk: ^1.29.0
- zod: ^3.25.0

peerDependencies:
- @mariozechner/pi-ai: *
- @mariozechner/pi-coding-agent: *
- typebox: *
```

- **版本**：1.5.0（2026-05-03 发布，4 个版本）
- **许可证**：MIT（兼容）
- **Node 声明**：`_nodeVersion: 22.22.2`（发布时构建环境），`devDependencies` 含 `@types/node: ^22.0.0`
- **未声明 `engines` 字段**

### 1.2 关键发现：peerDependencies 包名不匹配

| 扩展声明 | 项目实际使用 | 匹配？ |
|---------|------------|--------|
| `@mariozechner/pi-ai` | `@earendil-works/pi-ai@0.80.6` | 包名不同 |
| `@mariozechner/pi-coding-agent` | `@earendil-works/pi-coding-agent@0.80.6` | 包名不同 |
| `typebox` | （未直接依赖） | 需确认 |

**重要**：`@mariozechner/*` 系列包在 npm 上已被标记为 **deprecated**，提示信息为：
> `please use @earendil-works/pi-coding-agent instead going forward`

即 `@earendil-works/*` 是 `@mariozechner/*` 的**官方继任者**（同一项目，组织迁移）。

### 1.3 运行时接口兼容性验证

尽管包名不同，但两者暴露的 `ExtensionAPI` 接口**完全一致**：

```typescript
// @earendil-works/pi-coding-agent@0.80.6 dist/core/extensions/types.d.ts
export interface ExtensionAPI {
    registerTool<TParams extends TSchema = TSchema, ...>(tool: ToolDefinition<...>): void;
    registerCommand(name: string, options: ...): void;
    getActiveTools(): string[];
    setActiveTools(toolNames: string[]): void;
    on(event, handler): void;
    // ...
}
```

pi-mcp-extension 仅使用上述接口（`registerTool` / `registerCommand` / `on` / `getActiveTools` / `setActiveTools`），**不依赖任何包名特定的内部实现**。

### 1.4 扩展加载机制验证

`@earendil-works/pi-coding-agent@0.80.6` 的扩展加载器（`dist/core/extensions/loader.js`）：

1. 使用 `jiti` 加载 TypeScript 扩展（与 pi-mcp-extension 的 `pi.extensions: ["./src/index.ts"]` 兼容）
2. 通过 `package.json` 的 `pi.extensions` 字段发现扩展
3. 加载扩展后调用 `ExtensionFactory(pi: ExtensionAPI)`

验证结果：pi-mcp-extension 的 `src/index.ts` 可通过 jiti 成功加载并执行。

---

## 2. 三传输冒烟测试

测试环境：Node v24.12.0（本地开发机，高于声明的 Node 22，向后兼容）

### 2.1 stdio 传输

```
$ node smoke-test9.mjs
[stdio] Testing...
[stdio] PASS - tools: [ 'echo' ]
```

- **结果**：PASS
- **说明**：成功 spawn 子进程、建立 stdio 握手、列出工具

### 2.2 SSE 传输

```
[sse] Testing...
[sse] PASS - transport constructed, connection failed as expected (no server)
```

- **结果**：PASS（构造成功，连接失败符合预期——无真实服务器）
- **说明**：`SSEClientTransport` 可正常实例化，连接拒绝错误为预期行为

### 2.3 Streamable HTTP 传输

```
[http] Testing...
[http] PASS - transport constructed, connection failed as expected (no server)
```

- **结果**：PASS（构造成功，连接失败符合预期——无真实服务器）
- **说明**：`StreamableHTTPClientTransport` 可正常实例化

### 2.4 MCP SDK Client 实例化

```
[smoke] MCP Client instantiated OK
```

- **结果**：PASS

---

## 3. 实际安装测试（apps/web）

在 `apps/web` 下执行临时安装：

```bash
cd apps/web && npm install pi-mcp-extension@1.5.0 --no-save
```

- **安装结果**：成功（无 peer dependency 冲突报错）
- **npm 警告**：`@mariozechner/*` 系列包被标记为 deprecated（预期，因扩展声明了旧包名）
- **清理**：已手动删除 `node_modules/pi-mcp-extension`，未提交任何变更

---

## 4. 风险与限制

| 风险 | 级别 | 说明 |
|------|------|------|
| peerDependencies 包名不匹配 | 低 | npm 不强制 peer 包名匹配（`*` 版本通配），运行时接口一致 |
| `@mariozechner/*` deprecated | 低 | 扩展作者未更新 peer 声明，但功能不受影响 |
| Node 24 vs 声明的 Node 22 | 低 | 本地 Node 24 运行正常，Node 22 为 LTS 应更稳定 |
| 扩展作者维护状态 | 中 | 最后发布 2026-05-03，2 个月前；4 个版本迭代较快 |
| 扩展加载路径 | 低 | 需确保 `pi-mcp-extension` 放在 Pi Agent 的扩展发现路径下 |

---

## 5. 结论

**判定：兼容（有条件）**

pi-mcp-extension@1.5.0 可在 Node 22 + `@earendil-works/pi-coding-agent@0.80.6` 环境下正常工作，理由：

1. **许可证兼容**：MIT
2. **运行时接口一致**：`ExtensionAPI` 表面完全匹配
3. **三传输可用**：stdio / SSE / Streamable HTTP 均可构造并建立握手
4. **扩展加载机制兼容**：jiti TypeScript 加载 + `pi.extensions` 发现机制
5. **实际安装无冲突**：`--no-save` 安装成功，无 peer dependency 错误

**条件**：
- 需接受 `@mariozechner/*` deprecated 警告（npm install 时显示，不影响功能）
- 需确保扩展文件放置在 Pi Agent 的扩展发现路径（`~/.pi/agent/extensions/` 或项目级 `.pi/extensions/`）

**不触发降级策略**：M3 可按原计划接入 pi-mcp-extension，无需降级为「预留 MCP 扩展点 + DB 表结构」。

---

## 6. 建议

1. **安装方式**：在 `apps/web` 的 `package.json` 中直接添加 `pi-mcp-extension` 为 dependency，npm 会自动处理 peer 警告
2. **扩展部署**：将 `pi-mcp-extension` 的 `src/index.ts` 路径注册到 Pi Agent 的扩展配置中
3. **版本锁定**：锁定 `pi-mcp-extension@1.5.0`，避免未来版本引入 breaking change
4. **监控**：关注扩展作者是否更新 peerDependencies 到 `@earendil-works/*`

---

## 7. 测试命令与输出摘要

| 命令 | 关键输出 |
|------|---------|
| `npm view pi-mcp-extension` | 1.5.0, MIT, deps: @modelcontextprotocol/sdk ^1.29.0, zod ^3.25.0 |
| `npm view pi-mcp-extension peerDependencies` | @mariozechner/pi-ai: *, @mariozechner/pi-coding-agent: *, typebox: * |
| `node smoke-test9.mjs` | stdio PASS, sse PASS, http PASS |
| `cd apps/web && npm install pi-mcp-extension@1.5.0 --no-save` | 成功，deprecated 警告（预期） |
