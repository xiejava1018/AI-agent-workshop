# Messages 子渲染层

本目录用于 BlockView 树形渲染系统(参考 apps/web/components/MessageView.tsx 的 BlockView 形态)。

## 待办(T3.x / T4.x)
- BlockView.vue — 主分发组件
- TextBlock.vue — markdown 文本块
- ThinkingBlock.vue — 折叠思考块
- ToolCallBlock.vue — 工具调用块
- ImageBlock.vue — 图像块

所有子组件由 BlockView 按 `block.type` 分发;不直接由 MessageView 引用。
