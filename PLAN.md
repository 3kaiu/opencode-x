# opencode-x — Plan

## 概述

opencode-x 是 [anomalyco/opencode](https://github.com/anomalyco/opencode) 的个人 fork，目标是在**长期跟踪上游**的前提下，通过对抗审计验证所有多语言重构决策。

> **当前状态：6 Rust napi 模块 + 1 Zig WASM 模块 → 仅保留 1 个 Rust 模块 (grep)。**
> 全部 5 个被删除的模块均通过综合基准测试（速度 + 线程 + 内存 + 体积 + 并发 + 冷启动）验证为负价值。
> 见 `phases/00-cleanup.md` 详细完成记录。

| 来源 | 分支 |
|------|------|
| upstream | `anomalyco/opencode` (`dev`) |
| 本地 | `main`（基于 `upstream/dev`） |

## 架构设计

### 语言分工

| 模块 | 语言 | 方式 | 结论 |
|------|------|------|------|
| TUI | TypeScript + Bun | React Ink | 保留 |
| Agent loop | TypeScript | Effect 编排 | 保留 |
| Session store | TypeScript | bun:sqlite | Rust 替换为 bun（基准：5.5x 更快） |
| Glob | TypeScript | Bun.Glob | Rust 替换为 Bun（基准：2x 更快） |
| Prompt builder | TypeScript | string join | Rust 替换为 TS（基准：8x 更快） |
| Token counter | TypeScript | chars/4 启发式 | Rust+Zig 替换为 TS（基准：亚微秒级） |
| SSE stream | TypeScript | fetch | Rust 替换为 TS（基准：5.4x 更快） |
| **Grep** | **Rust** | **regex + tokio** | **保留（基准：~10000x 快于 ripgrep spawn）** |
| Tool exec (shell) | TypeScript | AppProcess | 保留 |
| File I/O | TypeScript | Bun fs | 保留 |
| Plugin / SDK / Schema | TypeScript | 原样 | 保留 |
| UI 组件 | TypeScript | 原样 | 保留 |

### 对抗审计结论

基于 3 轮综合基准测试（速度、冷启动、并发、可扩展性、事件循环阻塞、内存、CPU、线程模型）的最终决策矩阵：

```
模块          │ 速度 vs TS   │ 线程模型    │ 内存  │ 体积    │ 结论
─────────────┼─────────────┼───────────┼──────┼───────┼─────
grep         │ 🟢快10000x   │ 🟢async   │ 🟡中 │ 🟡0.3MB│ 保
glob         │ 🔴慢 2x      │ 🔴sync    │ 🟡中 │ 含上   │ 删
sqlite       │ 🔴慢 5.5x    │ 🔴sync    │ 🟡中 │ 🔴2.6MB│ 删
prompt-builder│🔴慢 8x     │ 🔴sync    │ 🟢小 │ 🔴0.9MB│ 删
tiktoken     │ 🟡不定       │ 🔴sync    │ 🔴大 │ 🔴5.9MB│ 删
SSE          │ 🔴慢 5.4x    │ 🟢async   │ 🟡中 │ 🔴4.0MB│ 删
```

**总计：16 MB .node + 194 crate 依赖 → 仅保留 270 KB grep。**

关键数据：
- **grep** 唯一 Rust 全面胜利（async 不阻塞事件循环，~10000x 快于 ripgrep spawn）
- **tiktoken** 5.9 MB 最大，BPE 对重复文本退化到 29ms/10KB，启发式在亚微秒级完成
- **Bun.Glob** 全面打败 Rust ignore，并发下快 2.2x，不阻塞事件循环
- **bun:sqlite** 比 rusqlite napi 快 5.5x，零构建开销
- **TS fetch** 比 reqwest napi 快 5.4x
- 10/12 Rust napi 函数是 sync（阻塞事件循环），只有 grepFiles + streamSse 是 async

### Rust 适用性原则（基准测试验证）

Rust napi-rs **仅**在以下场景提供价值：
1. **消除子进程开销且 Rust 算法显著更快** — grep（避免 fork+exec ripgrep，async napi）
2. 其他所有场景：Bun 原生 API 比 Rust FFI 更快，且不阻塞事件循环

### @opencode-ai/native-bridge 模式

原生模块通过 `@opencode-ai/native-bridge` 包间接暴露：

- `@opencode-ai/native-bridge/grep` → `natives/tool-exec/index.node`（Rust async）
- `@opencode-ai/native-bridge/glob` → Bun.Glob（纯 TS，之前是 Rust）

消费端统一通过 `@opencode-ai/native-bridge/*` 导入，实现层切换对调用方透明。

## 目录结构

```
opencode-x/
├── .upstream/                   ← git worktree (upstream/dev)
├── packages/
│   ├── core/                     ← 核心逻辑（event, session, tool, permission 等）
│   ├── opencode/                 ← CLI 入口 + HTTP server
│   ├── llm/                      ← LLM 路由与 provider
│   ├── tui/                      ← 终端 UI（保留视觉改进）
│   ├── plugin/                   ← 插件系统（V2 effect + promise）
│   ├── server/                   ← HTTP API 基础设施
│   ├── codemode/                 ← Code mode MCP 解释器
│   ├── schema/                   ← 共享 schema 定义
│   ├── protocol/                 ← 协议定义
│   ├── cli/                      ← npm CLI 包装器（lildax 入口）
│   ├── sdk/                      ← JS SDK
│   ├── effect-drizzle-sqlite/    ← 数据库层
│   ├── native-bridge/            ← glob 桥接
│   ├── script/                   ← 内部工具（semver 等）
│   ├── ...                       ← 其余保留
├── packages/core/
│   └── src/
│       ├── database/
│       │   ├── sqlite.bun.ts     ← bun:sqlite（默认）
│       │   └── sqlite.ts         ← types
│       └── util/token.ts         ← 纯 TS 启发式
├── packages/opencode/
│   └── src/session/
│       ├── prompt.ts             ← 纯 TS prompt 构建
│       └── system.ts             ← 导入 prompt
├── packages/llm/
│   └── src/route/transport/
│       └── http.ts               ← 纯 TS fetch
├── packages/native-bridge/       ← TS 壳（glob）
├── natives/                      ← 已删除（natives 目录完全移除，因上游已删）
├── phases/
│   └── 00-cleanup.md             ← 详细完成记录 + 基准测试
├── specs/                        ← V2 架构设计文档
├── patches/                      ← bun 依赖补丁
├── Formula/                      ← Homebrew formula（opencodex.rb）
├── MERGE.md                      ← 上游合并策略
├── package.json
```

## 实施阶段

### Batch 0: Fork + 清理 + 基础设施 ✅

- ✅ fork upstream 并建立 `.upstream` worktree
- ✅ 删除无用包: `app/`, `desktop/`, `slack/`, `enterprise/`, `web/`, `function/`, `http-recorder/`, `httpapi-codegen/`, `client/`, `sdk-next/`
- ✅ 删除无用目录: `artifacts/`, `github/`, `nix/`, `sdks/`, `specs/storage/`
- ✅ 删除上游脚本: `publish.ts`, `beta.ts`, `stats.ts`, `version.ts`, `changelog.ts`, `generate.ts` 等 14 个
- ✅ 删除 `.opencode/` 上游引用: `glossary/`, `agent/triage.md`, `command/issues.md`, `tool/github-pr-search.ts`
- ✅ 删除根文件: `.dockerignore`, `.gitleaksignore`, `flake.*`, `install`, `screenshot-uk.png`, `sst-env.d.ts`, `sst.config.ts`, `turbo.json`
- ✅ 删除 `.vscode/` 编辑器配置
- ✅ 清理 workflows: 22 → 2（`ci.yml` + `release.yml`）
- ✅ **保留 `codemode/`**（上游活跃的代码执行解释器）
- ✅ 删除 telemetry 残留（Sentry 覆盖已清理，无运行时引用）
- ✅ `natives/` 目录完全移除（上游已删 Rust 模块）
- ✅ 切 Bun 运行时，`bun run dev` 正常
- ✅ CI: typecheck + test
- ✅ 合并流程验证（MERGE.md）

### Batch 1:  Benchmark + 删除 3 个 Rust 模块 ✅

- ✅ 建立完整基准测试框架 `script/benchmark-native.ts`（速度、冷启动、并发、可扩展性、事件循环阻塞、内存、CPU、线程模型）
- ✅ **prompt-builder** → 删除 Rust crate（`natives/prompt-builder/`），替换为纯 TS `packages/opencode/src/session/prompt-builder.ts`，逻辑一致（5 函数）
- ✅ **token-counter (tiktoken)** → 删除 Rust crate（`natives/shared/`）+ Zig WASM（`natives/token-counter/`），替换为 TS 启发式 `Math.round(text.length / 4)`
- ✅ **provider-proxy (SSE)** → 删除 Rust crate（`natives/provider-proxy/`），`llm/http.ts` 简化为纯 TS fetch

### Batch 2: Benchmark + 删除 2 个 Rust 模块 ✅

- ✅ **sqlite** → 删除 Rust crate（`natives/sqlite/`），`#sqlite` 条件导入切到 `sqlite.bun.ts`
- ✅ **glob** → 删除 Rust `glob_files` 函数（`natives/tool-exec/`），`native-bridge/glob.ts` 改为 Bun.Glob

### Batch 3: 保留

- [ ] **grep** — Rust async napi 保留（唯一经得起审计的模块）

## 后续工作

### 短期

- [ ] 运行 E2E 验证：`bun run script/validate-e2e.ts`（确认删除后全链路正常）
- [ ] 读取 `specs/v2/todo.md` + `packages/plugin/src/v2/effect/PLAN.md`，了解上游 V2 方向
- [ ] 建立定期上游合并节奏

### 中期

- [ ] `cargo clean` 清除已删 crate 的构建缓存
- [ ] 评估 `packages/codemode/` 对 V2 架构的价值

## 合并策略

### 远程设置

已配置：`origin` (fork) + `upstream` (anomalyco/opencode)

### 定期合并流程

```bash
git fetch upstream
git merge upstream/dev
# 检查 package.json 依赖变更
# 检查 Rust 是否需要同步（仅 tool-exec）
# 检查被删文件冲突（modify/delete）
```

### 合并策略

- 保留完整上游历史（不 squash）
- `.upstream` 是 git worktree（非 submodule）
- 上游 V2 事件溯源架构需 schema-changelog 审查

### 冲突模式

| 来源 | 频率 | 影响 | 处理 |
|------|------|------|------|
| package.json 新依赖 | 中 | 全局 | 手动合并 |
| Native 模块对应 TS 壳 | 低 | 单文件 | 改类型声明 |
| 已删模块上游更新 | 高 | 无 | 自动 resolve |
| TUI/UI 组件变更 | 低 | 低 | 正常合入 |

## 构建系统

### 命令

```bash
bun run dev            # 开发模式
bun run typecheck      # 全量 typecheck
bun run lint           # oxlint
bun test               # 各包目录下运行 bun test
```

注意：`build:wasm` 和 `build:napi` 多模块循环已移除。

### 依赖

- Bun >= 1.3.14

## 保留包清单

```
packages/
├── cli/              ← npm CLI 入口（lildax）
├── codemode/         ← code mode MCP 解释器
├── core/             ← 核心逻辑
├── effect-drizzle-sqlite/ ← 数据库 ORM
├── llm/              ← LLM 路由
├── native-bridge/    ← glob 桥接
├── opencode/         ← CLI + HTTP server
├── plugin/           ← 插件系统
├── protocol/         ← 协议定义
├── schema/           ← 共享 schema
├── sdk/              ← JS SDK
├── script/           ← 内部工具
├── server/           ← HTTP 基础设施
└── tui/              ← 终端 UI
```

## 已删除

```
包: client, sdk-next, app, desktop, slack, enterprise, web, function, http-recorder, console, stats, containers, identity, storybook
目录: artifacts, github (action), nix, sdks/vscode, .vscode, specs/storage
脚本: beta, changelog, duplicate-pr, generate, publish, raw-changelog, stats, version, release, sign-windows
根文件: .dockerignore, .gitleaksignore, flake.*, install, screenshot-uk.png, sst-*, turbo.json
```

## 构件总览

```
TS Bun 原生（6 替代品，原 Rust 模块全部删除）
  bun:sqlite              已替换 Rust rusqlite（5.5x 更快）
  Bun.Glob                已替换 Rust glob（2x 更快）
  TS join                 已替换 Rust prompt-builder（8x 更快）
  TS 启发式               已替换 Rust+Zig tiktoken（亚微秒级）
  TS fetch                已替换 Rust reqwest SSE（5.4x 更快）
  grep                    跟随上游使用 ripgrep（natives/ 已全部删除）

TS 集成点
  database                 bun:sqlite（通过 #sqlite 条件导入）
  llm/http.ts              fetch（原生 Bun）
  session/system.ts        纯 TS prompt
  session/prompt.ts        纯 TS prompt
  util/token.ts            纯 TS 启发式

未做（已审计）
  Agent Loop Rust 重写     基准测试验证不值得（Effect 编排是 TS 强项）
  Shell exec Rust          进程 fork 是瓶颈，TS vs Rust 持平
  文件 I/O Rust            Node/Bun C++ 绑定比 Rust FFI 更快
  Provider 配置生成        7+ OpenAI 兼容 provider 可从 YAML 生成
```
