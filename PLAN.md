# opencode-x — Plan

## 概述

opencode-x 是 [anomalyco/opencode](https://github.com/anomalyco/opencode) 的个人精简 fork。

### 项目意图（作者意图，一切决策的最高准绳）

- **只为个人 agent 的终端使用而存在**：核心价值在 CLI + TUI 的编码体验；凡与此无关的能力（云端账户 / 多设备 sync / Session share / 遥测 OTEL / GitHub Copilot / 桌面端 desktop / Web UI / 企业与控制台 / 无消费方的 SDK 层）一律裁剪。
- **只删不改架构**：不主动重写上游架构，永远保持可持续跟随上游演进；偏离只应来自「删除不需要的」与「打磨已保留的」，不应来自「另起炉灶」。
- **长期跟踪上游，永不脱轨**：定期 sync upstream/dev，宁可小步高频，避免攒批产生大冲突。
- **一切偏离必须审计验证**：删除、保留、自有改进都要经对抗审计（并排比较、必要时基准测试）裁决，并登记在 MERGE.md 偏离清单，供下次 sync 复审。
- **持续打磨 TUI 到一流水准**：以 Claude Code / Qoder / Kimi CLI 的公共优点为参照，追求最佳阅读与交互体验，但动效克制、可关闭，尊重既有约束（如 Knight-Rider 扫描动画不动）。
- **PLAN.md 与 MERGE.md 是活文档**：始终反映真实状态；每次上游同步完毕后必须判断二者是否需要更新（见下方「文档同步准则」）。

### 定位与原则

- **长期跟踪上游**：跟随 upstream/dev 的演进，定期同步
- **只删不改架构**：不主动做架构改造，精简聚焦个人 agent 使用场景
- **一切偏离必须审计验证**：无论是删除、保留还是自有改进，都以对抗审计（并排比较、基准测试）为决策依据

| 来源 | 分支 |
|------|------|
| upstream | `anomalyco/opencode` (`dev`) |
| 本地 | `main`（基于 `upstream/dev`） |

### 文档同步准则（每次上游更新完毕后强制执行）

**每完成一次上游 sync，必须判断 PLAN.md 与 MERGE.md 是否需要更新，并据判断结果更新或显式记录「无需更新」**：

- **PLAN.md**：上游基线版本号与 sync 轨迹是否变化？是否出现新的已完成阶段 / 新保留或新删除的包 / 新的重大自有改进？
- **MERGE.md**：偏离清单是否需要回写（新增对抗审计裁决、移除上游已吸收的条目、删除已消失的载体文件）？已删/保留包列表、`script/merge-clean.ts` 清单是否需同步？
- 若判断确实无需改动，也应在 sync commit 说明中一句话记录「PLAN/MERGE 已复核，无需更新」，避免"忘记判断"与"判断过但没写"混淆。

## 当前状态

- **上游基线**：`v1.18.7`（sync 轨迹：v1.18.2 → v1.18.4 → v1.18.6 → v1.18.7）
- **包规模**：12 个包（11 个功能包 + sdk），原生模块（natives/）已全部删除，grep 跟随上游使用 ripgrep
- **裁剪工程（Batch 0–3）**：✅ 全部完成
- **TUI 审计打磨（四批 23 轮）**：✅ 全部完成
- **TUI 渲染深度打磨（Markdown 响应 + 会话元素视觉）**：✅ 完成（代码块面板化、流式防闪、reasoning 降透明 markdown、盲文渐变 spinner、GLYPH/MCP 状态字符统一、subagent agent-color 身份）
- **当前主线**：持续同步（Continuous Sync）

## 当前主线：持续同步阶段

裁剪工程已收尾，项目进入长期维护态。每次上游发布后执行一轮**审计式吸收**：

1. **目标**：只提取并比对上游的新特性与问题修复，保留更新、更有用的实现
2. **分诊原则**：
   - 落在已删模块的变更 → 自动丢弃
   - 上游 bug 修复 → 默认吸收
   - 上游新特性/新包 → 用途审计后决定引入或拒绝
   - 双方共同修改的模块 → 对抗审计判断最优实现
   - 上游纯重构 → 默认跟随（降低未来冲突面）
3. **节奏**：跟随上游 release 触发，不追单个 commit
4. **流程细节**：见 `MERGE.md`「审计式吸收流程」

## 历史阶段（已完成）

### Batch 0: Fork + 清理 + 基础设施 ✅

- fork upstream 并建立合并基线（graft 机制，见 MERGE.md）
- 审计并裁剪上游包：`app/`, `desktop/`, `slack/`, `session-ui/`, `enterprise/`, `web/`, `function/`, `console/`, `stats/`, `containers/`, `identity/`, `storybook/` 等
- 删除无用目录：`artifacts/`, `github/`, `nix/`, `sdks/`, `specs/storage/`
- 保留 `codemode/`（代码执行解释器）
- 切 Bun 运行时，CI: typecheck + test，合并流程验证（MERGE.md）

### Batch 1~2: Rust NAPI 替换与基准测试 ✅

原 6 Rust napi 模块 + 1 Zig WASM 模块，经 3 轮综合基准测试（速度、冷启动、并发、可扩展性、事件循环阻塞、内存、CPU、线程模型）后**全部删除**，`natives/` 目录移除，grep 跟随上游使用 ripgrep。

最终决策矩阵（留档，作为后续「是否引入原生模块」审计的参照）：

```
模块          │ 速度 vs TS   │ 线程模型    │ 内存  │ 体积    │ 结论
─────────────┼─────────────┼───────────┼──────┼───────┼─────
grep         │ 🟢快10000x   │ 🟢async   │ 🟡中 │ 🟡0.3MB│ 曾保留，后跟随上游 ripgrep
glob         │ 🔴慢 2x      │ 🔴sync    │ 🟡中 │ 含上   │ 删
sqlite       │ 🔴慢 5.5x    │ 🔴sync    │ 🟡中 │ 🔴2.6MB│ 删
prompt-builder│🔴慢 8x     │ 🔴sync    │ 🟢小 │ 🔴0.9MB│ 删
tiktoken     │ 🟡不定       │ 🔴sync    │ 🔴大 │ 🔴5.9MB│ 删
SSE          │ 🔴慢 5.4x    │ 🟢async   │ 🟡中 │ 🔴4.0MB│ 删
```

关键结论（**Rust napi 适用性原则**）：
- Rust napi-rs 仅在「消除子进程开销且 Rust 算法显著更快」时提供价值
- 其他所有场景：Bun 原生 API（bun:sqlite、Bun.Glob、fetch）比 Rust FFI 更快，且不阻塞事件循环
- 10/12 Rust napi 函数是 sync（阻塞事件循环）
- 替代实现：bun:sqlite（5.5x）、Bun.Glob（2x）、TS join（8x）、TS token 启发式（亚微秒级）、TS fetch（5.4x）

已审计不做的事：
- Agent Loop Rust 重写 — Effect 编排是 TS 强项
- Shell exec Rust — 进程 fork 是瓶颈，TS vs Rust 持平
- 文件 I/O Rust — Node/Bun C++ 绑定比 Rust FFI 更快

### Batch 3: 精简 Fork 裁剪工程（6 个子批）✅

- **B1 (Dead SDK Packages & Root Deps)**：删除 `cli`, `client`, `sdk-next`, `httpapi-codegen`, `native-bridge`, `script`, `Formula/` 及 `@aws-sdk/client-s3`, `heap-snapshot-toolkit`（-47,559 行）
- **B2 (Cloud Account / Sync / Share)**：删除设备码登录、账户模块、多设备 sync 及云端 Session share（-2,900 行）
- **B3 (OpenTelemetry Removal)**：物理拔除 `@effect/opentelemetry` 及 5 个相关依赖，`observability.ts` 简化为纯本地文件日志（-286 行，瘦身 10MB+ node_modules）
- **B4 (GitHub Copilot & OAuth Page Removal)**：删除整个 GitHub Copilot 模块及旧版 OAuth HTML 模板（-8,829 行）
- **B5 (Bedrock & Cloudflare Clean)**：删除 Amazon Bedrock 和 Cloudflare Workers AI/Gateway Provider 插件及测试（-1,700 行）
- **B6 (Web UI Purge & Asset Relocation)**：删除 `packages/ui` 废弃 Web 框架包，重定位 60 个 `.mp3` 音效至 `packages/tui/src/assets/audio/`

### TUI 审计打磨（四批 23 轮）✅

对 `packages/tui`（Solid + opentui 终端 UI）的迭代式审计，每轮遵循「审计 → 修复 → 验证」闭环（typecheck 0 错误 + 全量测试绿为门禁）：

- **第一批（8 轮）+ 第二批（5 轮）**：全方位审计与修复
- **第三批（5 轮 A1–A5）**：类型安全、错误处理（floating promise）、代码风格、死代码清理（删除 `routes/session/{sidebar,footer,status-bar,dialog-subagent}.tsx`、`feature-plugins/sidebar/*`、`curve-spinner`、`dialog-tag`、`primitives`、`util/{animation,curve-engine,layout,responsive}` 等）、oxlint 治理
- **第四批（5 轮 B1–B5）**：视觉与 UX 专项——主题色彩系统（selectedForeground 统一）、间距布局一致性、文案规范、交互状态完整性（空态/加载态语义化）、动效与感知性能（animations_enabled 全覆盖）

这些偏离已计入 MERGE.md 偏离清单，后续 sync 时与上游对抗审计。

### TUI 渲染深度打磨（Markdown 响应 + 会话元素视觉）✅

在四批审计之后，对 AI 响应的 Markdown 渲染质量与会话各元素（think/tool/skill/mcp/todo/subagent/summary）视觉体系做了一轮深度打磨（综合 Claude Code / Qoder / Kimi CLI 的公共优点）：

- **围栏代码块面板化**：`splitProseAndCode` 分段 + `CodeBlock` 组件（面板底色 + 语言标签 + 行号），`getSyntaxRules` 引用 `markdownCodeBlock` token，`resolveTheme` 增背景兜底
- **流式防闪**：`TextPart` 流式期间走单个稳定 `<markdown streaming>`，完成后再切 `<For>` 分段（避免逐 token 重建 renderable）
- **Reasoning 降透明 markdown**：`subtleSyntax()` 渲染思考正文，保留列表/代码/加粗
- **盲文渐变 spinner**：`Bullet` 用 `ColorGenerator` 基色↔accent 呼吸流转（受 `animations_enabled` 约束）
- **状态字符统一**：新增 `ui/glyphs.ts`（含 `GLYPH.mcp` 组），收敛 footer/dialog-status/dialog-mcp 的 MCP 状态字符
- **Subagent 身份**：`Task` 运行态 bullet + `SubagentFooter` 标签用 `local.agent.color` 上色，保留 success/error/retry 状态色语义

这些偏离已计入 MERGE.md 偏离清单，后续 sync 时与上游对抗审计。

### 安全加固与测试套件修复（模块深度审计一轮）✅

在模块化深度审计中发现并处理：

- **反射型 XSS 修复**：上游 `a2b5baf793` 删除 `core/src/oauth/page.ts`（统一转义 OAuth 页）后，fork 的 4 处 OAuth 回调 handler 仍内联未转义的 `Authorization failed: ${error}`。用现有 `@/util/html` 的 `escapeHtml()` 包裹（`plugin/openai/codex.ts`、`mcp/oauth-callback.ts`、`plugin/xai.ts`、`plugin/snowflake-cortex.ts`）。已登记 MERGE.md 加固偏离。
- **测试套件修复（15 失败 → 3 环境失败）**：删除已删功能的孤儿测试、修剪混合测试、移除过期断言（`autoShare`）、重定位机制测试（auth-override 从已删的 github-copilot 改为存活的 xai），并把 account CLI cmd、sync httpapi group 及关联测试补入 `merge-clean.ts` 清单。剩余 3 个失败为本地 npm registry（`registry.npmmirror.com`）环境问题，非代码缺陷。

### NEEDS-JUDGMENT 审计裁决（对抗审计结论：均维持现状）

对前一轮标记的 6 项存疑项逐一对抗审计，结论**全部维持现状（不动）**，理由记录如下（供下次复审）：

1. **`experimental.ts` Console 路由**（console/consoleOrgs/consoleSwitch）→ **保留**。虽是账号功能删除后的空 stub，但 fork 自有 TUI 仍消费这些端点（`tui/component/dialog-console-org.tsx`、`context/sync.tsx:462`）且生成的 SDK 依赖其形状；删除会破坏 TUI，属"载力代码"，非死码。
2. **`handlers/tui.ts:13` `session_share` 别名** → **保留**。legacy 命令别名映射，发布未知命令对 TUI 无害；上游所有权代码，改动即冲突成本，收益为零。
3. **OTEL 配置** → **保留（非残留）**。`cfg.experimental?.openTelemetry` 在 `llm.ts`/`agent.ts` 实际生效，`workspace.ts` 正常转发 OTLP 环境变量，功能存活。
4. **`build.ts` 内嵌 Web UI 路径** → **保留（非死路径）**。`packages/app` 仍在（构建路径有 `fs.existsSync` 守卫，缺失时优雅跳过）。
5. **`cli/error.ts:105` "auth login" 文案** → **保留**。`auth login <url>` 命令经 `providers.ts` 别名（`auth` → `providers login [url]`）实际存活；唯一瑕疵是二进制名 `opencode` vs `ocx`，属遍布多文件的独立文案议题，非删除残留，超出本轮范围。

**裁决准则**：上游所有权代码的每处改动都是永久合并冲突成本，"只删不改"下的诚实默认是"保留上游"，除非收益大、隔离好、冲突低。以上 6 项无一满足，故均不动。

## 保留包清单（12 个包）

```
packages/
├── codemode/               ← code mode MCP 解释器
├── core/                   ← 核心逻辑（event, session, tool, permission 等）
├── effect-drizzle-sqlite/  ← 数据库 ORM（Drizzle + Effect SqlClient）
├── http-recorder/          ← VCR 测试录制回放工具
├── llm/                    ← LLM 路由与 provider
├── opencode/               ← CLI 入口 + HTTP server
├── plugin/                 ← 插件系统（V2 effect + promise）
├── protocol/               ← 协议定义
├── schema/                 ← 共享 schema 定义
├── sdk/                    ← legacy JS SDK（生成产物，脚本重生成）
├── server/                 ← HTTP API 基础设施
└── tui/                    ← 终端 UI（Solid + opentui + 内置音效）
```

## 已删除包与模块

```
包: app, desktop, session-ui, slack, enterprise, web, function, console, stats,
    containers, identity, storybook, httpapi-codegen, docs, effect-sqlite-node,
    ui, cli, client, sdk-next, native-bridge, script
原生模块: natives/ 全部（6 Rust napi + 1 Zig WASM）
云端与遥测: Account, Sync, Share, OpenTelemetry (OTEL), GitHub Copilot,
           Amazon Bedrock, Cloudflare Workers AI
目录: artifacts, github (action), nix, sdks/vscode, .vscode, specs/storage, Formula
脚本: beta, changelog, duplicate-pr, generate, publish, raw-changelog, stats,
     version, release, sign-windows
```

删除清单的执行与维护见 `script/merge-clean.ts` 与 MERGE.md。
