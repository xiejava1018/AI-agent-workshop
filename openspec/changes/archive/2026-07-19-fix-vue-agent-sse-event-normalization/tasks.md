## 1. 事件适配回归保护

- [x] 1.1 使用 pi SDK 真实事件 fixture 为文本增量、用户/助手角色过滤和 `prompt_error` 可见性补充 RED 测试，并实现可复用的纯事件归一化函数使测试转绿

## 2. 活跃工作台接入与验证

- [x] 2.1 将归一化函数接入活跃 `useEventStream`、复用到旧事件 composable，运行相关单元测试、dashboard 构建和真实 Agent 工作台 E2E
