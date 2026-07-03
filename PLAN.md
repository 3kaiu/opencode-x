# opencode-x — 多语言重构计划

## 概述

opencode-x 是 [anomalyco/opencode](https://github.com/anomalyco/opencode) 的个人 fork，目标是在**长期跟踪上游**的前提下，用多语言重构关键模块以降低内存占用、提升性能，并删除无用代码。

| 来源 | 最新稳定 tag |
|------|-------------|
| upstream | `anomalyco/opencode` (dev) |

## 架构设计

### 语言分工

| 模块 | 语言 | 方式 | 理由 |
|------|------|------|------|
| TUI | TypeScript + Bun | React Ink 栈 | 无可替代 |
| UI 组件 / SDK / Schema | TypeScript | 保留原样 | 不值得移 |
| Plugin 系统 | TypeScript | 保留原样 | 动态加载需求 |
| Agent loop | Rust | napi-rs 绑定 | 复杂状态机，内存↓ 50% |
| Tool exec | Rust | napi-rs 绑定 | OS 交互，Rust 强项 |
| Session store | Rust | napi-rs + rusqlite | 持久层，内存↓ 70% |
| Provider proxy | Rust | napi-rs, tokio+reqwest | 网络 I/O，Rust 足够，不另起 sidecar |
| Prompt builder | Rust | napi-rs | 模板+字符串，内存↓ 60% |
| **Token counter** | **Zig** | **→ WASM** | **纯函数热路径，二进制最小 (~10KB)** |
| 其余 | TypeScript | 保留 | 不值得移 |

### 架构分层

```
┌──────────────────────────────────────────────────────┐
│  Bun/Node.js 进程                                      │
│                                                        │
│  ┌──────────────────────────────────────────────────┐ │
│  │  TUI (React Ink) — TS                             │ │
│  │  Plugin system — TS                               │ │
│  │  SDK / Schema / Client — TS                       │ │
│  └──────────────────────────────────────────────────┘ │
│                          ↕                             │
│  ┌──────────────────────────────────────────────────┐ │
│  │  Rust napi-rs 原生模块                             │ │
│  │  ├─ agent_loop (状态机 + 编排)                     │ │
│  │  ├─ tool_exec (shell + fs + glob)                 │ │
│  │  ├─ session_store (rusqlite)                      │ │
│  │  ├─ provider_proxy (reqwest + SSE)                │ │
│  │  └─ prompt_builder (模板 + 消息装配)               │ │
│  └──────────────────────────────────────────────────┘ │
│                          ↕                             │
│  ┌──────────────────────────────────────────────────┐ │
│  │  Zig WASM (token counter)                         │ │
│  └──────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────┘
```

### TS 壳模式

每个被替换的模块保留一个薄 TS 壳，导出与 upstream 相同的签名：

```
packages/opencode/src/session/
├── prompt.ts           ← TS 壳: export { runLoop, ... } 分发到 native
├── prompt.impl.ts      ← Rust 实现导入: import { runLoop } from '../../native'
└── prompt.orig.ts      ← 上游原始 TS 实现（兜底/参考）

packages/core/src/agent/
├── loop.ts             ← TS 壳
├── loop.impl.ts        ← Rust 实现
└── loop.orig.ts        ← 上游原始
```

## 目录结构

```
opencode-x/
├── .upstream/                   ← upstream 原始镜像（merge 辅助）
├── packages/
│   ├── tui/                     ← TS (React Ink)
│   ├── core/                    ← TS + Rust napi
│   │   ├── src/
│   │   └── native/              ← Cargo.toml + Rust 源码
│   ├── opencode/                ← TS + Rust napi
│   │   ├── src/
│   │   └── native/
│   ├── schema/                  ← 纯 TS
│   ├── sdk/                     ← 纯 TS
│   ├── protocol/                ← 纯 TS
│   ├── plugin/                  ← 纯 TS
│   └── ...                      ← 其余保留
├── natives/                    ← 跨包共享 Rust 库
│   ├── Cargo.toml (workspace)
│   ├── token-counter/          ← Zig → WASM
│   │   ├── build.zig
│   │   └── src/main.zig
│   └── shared/                 ← Rust 共享工具
├── package.json
└── Cargo.toml
```

## 实施阶段

### Phase 0: Fork + 清理 + 基础设施 (1-2 天)

- [ ] fork upstream (固定到最近稳定 tag)
- [ ] 删除无用包: `app/`, `desktop/`, `slack/`, `enterprise/`, `web/`, `codemode/`
- [ ] 删除 telemetry (Sentry, OpenTelemetry)
- [ ] 搭建目录结构骨架
- [ ] 切 Bun 运行时（验证兼容）
- [ ] 配置 Cargo workspace + napi-rs 脚手架
- [ ] 配置 Zig WASM 构建
- [ ] 验证：`bun run dev` 能启动
- [ ] 设置 CI (Rust + TS + Zig)
- [ ] 设置远程 upstream，测试 merge 流程

### Phase 1: Token Counter — Zig WASM (3-5 天)

- [ ] 在 `natives/token-counter/` 实现 Zig 版 token counter
- [ ] 编译为 WASM
- [ ] 在 TS 层封装 loader
- [ ] 集成到 `opencode/src/session/session.ts`
- [ ] 验证：token 计数正确性、性能对比
- [ ] Merge test: 合入一个上游小更新确认流程无冲突

### Phase 2: Session Store — Rust + rusqlite (1 周)

- [ ] 在 `natives/shared/` 实现 Rust 版 SQLite session store
- [ ] napi-rs 绑定导出
- [ ] 替换 `effect-drizzle-sqlite` + `effect-sqlite-node` 的调用
- [ ] 验证：session 读写、历史记录、快照
- [ ] 对比内存占用

### Phase 3: Prompt Builder — Rust (2 周)

- [ ] 分析 `prompt.ts` 中可隔离的纯计算部分（模板、消息装配）
- [ ] Rust napi-rs 实现
- [ ] TS 壳 `prompt.ts` → `prompt.impl.ts` 分发
- [ ] 验证：所有 prompt 类型、模板替换正确性

### Phase 4: Provider Proxy — Rust (3-4 周)

- [ ] 分析 provider.ts 的分发逻辑
- [ ] Rust napi-rs 实现 provider resolution + streaming
- [ ] 保持 AI SDK 兼容（`streamText` 接口）
- [ ] 验证：各 provider 流式响应、超时、错误处理
- [ ] 对比内存：Node 版 vs Rust 版

### Phase 5: Tool Exec — Rust (2 周)

- [ ] Rust napi-rs 实现 shell exec、file read/write、glob、grep
- [ ] TS 壳包装
- [ ] 验证：各工具功能正确性、权限控制
- [ ] 对比：进程启动速度、内存

### Phase 6: Agent Loop — Rust (4 周)

- [ ] 分析 agent loop 完整状态机
- [ ] Rust napi-rs 实现 loop 核心（不替换全部，先替换编排层）
- [ ] TS 壳保留复杂路由和 fallback
- [ ] 验证：完整 session 流程、subtask、tool call 编排
- [ ] 压力测试：长 session、大上下文

## 合并策略

### 远程设置

```bash
git remote add upstream https://github.com/anomalyco/opencode.git
git fetch upstream
git checkout -b main upstream/dev  # 初始基于 upstream dev
```

### 定期合并流程

```bash
git fetch upstream
git merge upstream/dev
# 处理冲突（主要在 TS 壳文件和 package.json）
# 检查 Rust/Zig 是否需要同步变更
```

### 冲突预测

| 冲突来源 | 频率 | 影响范围 | 修复成本 |
|---------|------|---------|---------|
| package.json (加新依赖) | 高 | 全局 | 低 (手动加) |
| TS 壳接口签名变化 | 低 | 单文件 | 低 (改类型声明) |
| 被删模块 TS 实现在上游更新 | 频繁 | 无 | 零（你的 Rust 体独立） |
| 上游增加新工具 | 中 | 单文件 | 中 (Rust 实现 + TS 壳) |
| 构建脚本变更 | 低 | 全局 | 低 |

## 构建系统

### 命令

```bash
bun run build          # TS-only 构建（快速迭代）
bun run build:native   # Rust + Zig 原生构建（完整）
bun run build:all      # 全量构建
bun run dev            # 开发模式
bun test               # 所有测试
```

### 依赖

- Bun (>= 1.0)
- Rust (>= 1.75) + wasm-pack + napi-rs
- Zig (>= 0.13)

## 风险评估

| 风险 | 概率 | 影响 | 缓解 |
|------|------|------|------|
| 上游频繁改核心接口 | 中 | 高 | TS 壳保持签名兼容，每次合并检查 |
| Rust 学习曲线 | 中 | 中 | Phase 0 先搭建基础设施练手 |
| napi-rs 跨平台兼容 | 低 | 中 | CI + 本地开发一致 |
| Zig WASM 加载/调用性能不如预期 | 低 | 低 | 可退化为 Rust WASM 或纯 TS |
| 上游 PR 不可合入 | 高 | 低 | 这是个人 fork，不需要上游接受 |
| 维护精力不足 | 中 | 高 | 可做 Phase 0-2 即获大部分收益 |

## 里程碑

| 里程碑 | 内容 | 预计时间 |
|--------|------|---------|
| M1 | Fork + 清理 + Bun + 构建链 | 1-2 天 |
| M2 | Token counter → Zig WASM，第一个原生模块上线 | +3-5 天 |
| M3 | Session store → Rust，持久层内存↓ 70% | +1 周 |
| M4 | Prompt builder → Rust，核心字符串路径加速 | +2 周 |
| M5 | Provider proxy → Rust，网络 I/O 路径加速 | +3-4 周 |
| M6 | Tool exec + Agent loop → Rust，全核心原生 | +6 周 |
| M7 | 全线稳定，确认 merge 流程常态化 | +2 周 |

总预计：**3-4 月**（单人业余），前 3 个里程碑（~2 周）即可获得主要收益。
