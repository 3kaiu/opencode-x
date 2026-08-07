# opencode-x

CLI/TUI 聚焦的 opencode fork：让 LLM（大脑）在终端世界行动的外脑 + 四肢。V2 架构主轴：SessionV2 状态机 + EventV2 事件溯源 + LLM Protocol 四参数管线。

## 导航

| 文档 | 角色 |
|---|---|
| `ARCHITECTURE_CONSTITUTION.md` | **唯一架构宪法（SSOT）**：项目/包/模块级规范、依赖规则、实现约束、演进原则。一切设计与实现只引用此文档 |
| `AGENTS.md` | AI 工作方式与协作规范（提交、风格、纪律） |
| `packages/*/AGENTS.md` | 各包工具指南（不承载架构约束） |

除此之外不维护任何设计文档；设计补充直接更新宪法。

## 结构

```text
packages/
├── schema            契约层（唯一数据形状来源）
├── protocol          HTTP API 契约
├── llm               模型层（LLM Protocol + provider）
├── core              领域内核（SessionV2/EventV2/工具/权限/配置）
├── server            HTTP 服务组装（零领域实现）
├── plugin            插件 API（v2 主轴）
├── opencode          组合根/CLI（run/serve/attach/tui/init）
├── tui               终端 UI
├── sdk/js            客户端生成面（v2/gen）
├── codemode          独立工具
├── http-recorder     开发工具（HTTP 录制/回放）
└── effect-drizzle-sqlite  基础设施（drizzle × Effect）
```

## 快速开始

```bash
cd packages/opencode && bun install && bun dev   # 交互 TUI
cd packages/opencode && bun run typecheck        # 包级 typecheck
cd packages/core && bun test                     # 包级测试（禁止从仓库根跑）
```

## 实施流程

严格瀑布式（见宪法 §0「先收敛、后实现」）：项目级 → 包级 → 模块级收敛 → 包实现 → 包验收 → 下一个包。批次顺序见宪法 §5.1。任何包不得留 TODO/半成品进入下一阶段。
