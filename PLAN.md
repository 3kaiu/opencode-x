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
│   ├── tui/                      ← 终端 UI（Solid-TUI + 内置音效）
│   ├── plugin/                   ← 插件系统（V2 effect + promise）
│   ├── server/                   ← HTTP API 基础设施
│   ├── codemode/                 ← Code mode MCP 解释器
│   ├── schema/                   ← 共享 schema 定义
│   ├── protocol/                 ← 协议定义
│   ├── http-recorder/            ← VCR 测试录制回放
│   └── effect-drizzle-sqlite/    ← 数据库层
├── patches/                      ← bun 依赖补丁
├── MERGE.md                      ← 上游合并策略
├── package.json
```

## 实施阶段

### Batch 0: Fork + 清理 + 基础设施 ✅

- ✅ fork upstream 并建立 `.upstream` worktree
- ✅ 审计上游新增包：初次裁剪（`app/`, `desktop/`, `slack/`, `session-ui/`, `enterprise/`, `web/`, `function/`, `console/`, `stats/`, `containers/`, `identity/`, `storybook/`）
- ✅ 删除无用目录: `artifacts/`, `github/`, `nix/`, `sdks/`, `specs/storage/`
- ✅ **保留 `codemode/`**（代码执行解释器）
- ✅ `natives/` 目录完全移除（跟随上游使用 ripgrep）
- ✅ 切 Bun 运行时，`bun run dev` 正常
- ✅ CI: typecheck + test
- ✅ 合并流程验证（MERGE.md）

### Batch 1~2: Rust NAPI 替换与基准测试 ✅

- ✅ **prompt-builder** → 替换为纯 TS `packages/opencode/src/session/prompt-builder.ts`
- ✅ **token-counter (tiktoken)** → 替换为 TS 启发式 `Math.round(text.length / 4)`
- ✅ **provider-proxy (SSE)** → 替换为纯 TS fetch
- ✅ **sqlite** → `sqlite.bun.ts`
- ✅ **glob** → Bun.Glob

### Batch 3: 个人精简 Fork 裁剪工程（Lean Fork Trimming - 6 个 Batch） ✅

- ✅ **Batch 1 (Dead SDK Packages & Root Deps)**: 删除 `cli`, `client`, `sdk-next`, `httpapi-codegen`, `native-bridge`, `script`, `Formula/` 以及 `@aws-sdk/client-s3`, `heap-snapshot-toolkit`。(-47,559 行代码)
- ✅ **Batch 2 (Cloud Account / Sync / Share)**: 删除设备码登录、账户模块、多设备 `sync` 及云端 Session `share` 逻辑。(-2,900 行代码)
- ✅ **Batch 3 (OpenTelemetry Removal)**: 物理拔除 `@effect/opentelemetry` 及 5 个相关 OTEL 依赖，简化 `observability.ts` 为纯本地文件日志。(-286 行代码，瘦身 10MB+ node_modules)
- ✅ **Batch 4 (GitHub Copilot & OAuth Page Removal)**: 删除整个 GitHub Copilot 模块（Chat/Responses LM + CLI 处理器）及旧版 OAuth HTML 模板。(-8,829 行代码)
- ✅ **Batch 5 (Bedrock & Cloudflare Clean)**: 删除 Amazon Bedrock 和 Cloudflare Workers AI/Gateway Provider 插件及测试。(-1,700 行代码)
- ✅ **Batch 6 (Web UI Purge & Asset Relocation)**: 彻底删除 `packages/ui` 废弃 Web 框架包，重定位 60 个 `.mp3` 音效至 `packages/tui/src/assets/audio/`。

---

## 保留包清单 (11 个包)

```
packages/
├── codemode/               ← code mode MCP 解释器
├── core/                   ← 核心逻辑
├── effect-drizzle-sqlite/  ← 数据库 ORM
├── http-recorder/          ← VCR 测试录制回放工具
├── llm/                    ← LLM 路由与 provider
├── opencode/               ← CLI + HTTP server
├── plugin/                 ← 插件系统
├── protocol/               ← 协议定义
├── schema/                 ← 共享 schema
├── server/                 ← HTTP 基础设施
└── tui/                    ← 终端 UI
```

## 已删除包与模块

```
包: app, desktop, session-ui, slack, enterprise, web, function, console, stats, containers, identity, storybook, httpapi-codegen, docs, effect-sqlite-node, ui, cli, client, sdk-next, native-bridge, script
云端与遥测功能: Account, Sync, Share, OpenTelemetry (OTEL), GitHub Copilot, Amazon Bedrock, Cloudflare Workers AI
目录: artifacts, github (action), nix, sdks/vscode, .vscode, specs/storage, Formula
脚本: beta, changelog, duplicate-pr, generate, publish, raw-changelog, stats, version, release, sign-windows
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
