# opencode-x — Plan & Intent

> **给 AI 的阅读指南**：这是本仓库的「宪法」。做任何决策（改代码、删功能、sync 上游、恢复或拒绝上游内容）之前，先读本节。本文件随上游演进持续更新，**每次 sync 后必须复核**。
>
> **一句话**：opencode-x 是 anomalyco/opencode 的个人精简 fork——只为个人终端 CLI/TUI 使用，砍掉一切云/企业/遥测/前端/无消费方的东西，保留并打磨核心编码体验，长期小步跟随上游。

---

## 1. 核心意图（最高准绳，任何决策以此裁决）

### 1.1 保留什么

- **个人 agent 的终端编码体验**：CLI + TUI 是唯一产品形态
- **本地运行时链**：`schema → protocol → llm → core → server/plugin → opencode → tui`，外加 `sdk`（生成产物）、`codemode`（沙箱解释器）、`http-recorder`（测试工具）、`effect-drizzle-sqlite`（DB 桥接）
- **纯本地价值命令**：`stats`（本地 token/成本统计）、`import`/`export`（本地会话备份恢复）、`serve`、`db`、`models` 等
- **自有改进**：V2 Session 核心、TUI 打磨、安全加固——这些是 fork 的增值，不是偏离

### 1.2 删除什么（结构性删除，不留残余）

凡属以下类别，**一律删除，且同步清除依赖声明、接线、注册、测试、SDK 生成面**：

| 类别 | 具体内容 |
|---|---|
| 云端账户 | `account`、`console`（云 SaaS：计费/登录/用量） |
| 多设备同步 | `sync`（骨架）、`function`（Cloudflare 同步后端）、workspace 远程同步 |
| 会话分享 | `share`、`enterprise`（云分享 S3）、`web` 的分享页 |
| 遥测 | OpenTelemetry（`otlp.ts`、`@opentelemetry/*`、`observability.ts` 简化为本地文件日志） |
| 企业级 | `enterprise`、`identity`（品牌资产）、`stats` 云站点（≠ CLI `stats` 命令！） |
| 桌面/浏览器前端 | `desktop`（Electron）、`app`、`web`（官网）、`ui`、`session-ui`、`storybook` |
| CI/发布 | `containers`、`script` 包（≠ 根目录 `script/`）、`docs`、`github/`、`nix/`、`sdks/vscode` |
| 无消费方的 SDK | `client`、`sdk-next`、`httpapi-codegen`（三者互为消费链，fork 无使用者） |
| GitHub Actions 集成 | `github.ts` 三件套、`@octokit/*`、`@actions/*`、`@gitlab/opencode-gitlab-auth` |
| 已删提供方 | Amazon Bedrock、Cloudflare Workers AI/Gateway、GitHub Copilot、OpenCode 云 provider |
| 原生模块 | `natives/` 全部（6 Rust napi + 1 Zig WASM，基准测试后删除，见 §5） |
| 其他 | `mdns`、`acp`（Agent Client Protocol）、`pr`、`web` 命令、`spawn_agent` 假工具链 |

### 1.3 如何裁决上游新变化（sync 时）

见 MERGE.md「五类分诊」。核心原则：

1. **落在已删模块的变更** → 自动丢弃（merge-clean 脚本执行）
2. **上游 bug 修复** → 默认吸收
3. **上游新特性/新包** → 用途审计：对个人终端有用→引入；云/企业/前端/遥测/无消费方→拒绝
4. **双方共改** → 对抗审计（并排比较，正确性 > 完整性 > 性能 > 可维护性 > 精简）
5. **上游纯重构** → 默认跟随

### 1.4 边界与红线

- **只删不改架构**：不主动重写上游架构；偏离只来自「删除不需要的」与「打磨已保留的」
- **Rust napi 适用性原则**：仅在「消除子进程开销且 Rust 算法显著更快」时考虑原生模块（见 §5 基准结论）
- **TUI 打磨**：参照 Claude Code / Qoder / Kimi 公共优点，动效克制可关闭，Knight-Rider 扫描动画不动
- **所有决策必须登记**：删除/保留/改进都记录到 MERGE.md「偏离清单」，下次 sync 复审

---

## 2. 当前状态

- **上游基线**：`v1.18.10`（sync 轨迹：v1.18.2 → v1.18.4 → v1.18.6 → v1.18.7 → v1.18.8 → v1.18.9 → v1.18.10）
- **待办**：v1.18.11 已发布，其保留包改动已手工核对（2 个修复，内容与本地一致），待正式 sync 并回写文档
- **包规模**：12 个包（见 §4.1），`natives/` 已全删
- **功能完成度**：
  - 裁剪工程（Batch 0–3）：✅
  - V2 核心引擎（Event Sourcing / Runner / Epochs / Tool Registry / PermissionV2）：✅ 100%
  - V2 外围（Config V2 / Plugin V2 / EventV2 TUI 消费）：✅
  - TUI 审计打磨（四批 23 轮）+ 渲染深度打磨：✅
  - 深度优化（7 批次跨层）：✅
  - `stats`/`import` 命令恢复（2026-08-03）：✅
  - **V2 支撑架构体系**（`specs/v2/llm-consumer-architecture.md`）：✅ 已建立并全量落地（M1–M12 十二模块 + 真实模型验证，v2.13，122 测试全绿）
  - **V2 产品化入口**：✅ `opencode v2 <prompt>` CLI 命令（真实工具 + durable memory 复用 + 失败教训自动沉淀）
- **当前主线**：持续同步（Continuous Sync）+ 活文档（PLAN/MERGE）对齐 + V2 支撑架构体系已 100% 落地（v2.14：M1–M12 全模块 + 编排器三模式（反应式/计划驱动/steer 缓冲）+ 验证器自动触发 + CLI 入口，无剩余「待接线」）+ 下一步将 V2 编排器接入会话运行路径（需与 V2 Session 核心工作衔接）

---

## 3. 上游全包架构审计（v1.18.11 快照，33 包全量）

> **用途**：sync 时上游带回任何包，先查此表判断「保留/删除」；新出现的包按 §1.3 裁决并回填此表。

上游 `packages/` 分三条链：

```
本地运行时链（保留）:  schema → protocol → llm → core → server/plugin → opencode → tui
前端链（全删）:        ui → session-ui → app/enterprise/console + storybook（文档）
云/SaaS 链（全删）:    console、function、stats（站点）、web、enterprise、desktop（部分云）
```

### 3.1 保留包（12 个）

| 包 | 职责 | 依赖方向 |
|---|---|---|
| `schema` | 全仓库唯一 Effect Schema 定义层：领域实体类型/编解码的「真理之源」 | 仅依赖 effect；被一切包依赖 |
| `protocol` | Effect `HttpApi` 声明 HTTP API 契约（groups + middleware 放置权 + OpenAPI 生成），纯声明 | 依赖 schema；被 server/opencode 依赖 |
| `llm` | 独立于 provider 的 LLM 传输层：统一各家 wire protocol 为 Effect 流式接口 | 依赖 schema；被 core 依赖 |
| `core` | 纯领域核心：V2 Session、工具注册表、权限、数据库、文件系统、插件宿主、配置、Provider、System Context | 依赖 schema/llm/plugin/effect-drizzle-sqlite |
| `server` | 独立 HTTP 实现层：protocol 契约落地为 Effect HttpServer（handlers + middleware + 服务组装） | 依赖 core/protocol；被 opencode 依赖 |
| `plugin` | 插件作者的公开 API 包：v1 promise + v2 effect 两套 | 依赖 sdk 类型/effect/zod |
| `opencode` | 可执行应用（composition root）：CLI 入口、instance HttpApi 服务端、配置、会话编排 | 依赖全部保留包 |
| `tui` | SolidJS + OpenTUI 终端界面：聊天会话、路由、命令面板、功能插件 | 依赖 core/plugin/sdk；被 opencode 启动 |
| `sdk` | 生成的 TS 客户端 SDK（legacy JS SDK，v1 + v2 生成面） | 运行时仅依赖 cross-spawn；构建期依赖 opencode generate |
| `codemode` | 代码模式 TS 子集解释器：沙箱执行模型产出的受限 TS | 依赖 acorn/typescript/effect；被 opencode 依赖 |
| `http-recorder` | HTTP 流量录制/回放（cassette），测试离线重放 | 仅 Effect 生态；被 opencode/llm 测试使用 |
| `effect-drizzle-sqlite` | Drizzle ORM × Effect SqlClient 桥接 | 依赖 drizzle-orm/effect；被 core 依赖 |

### 3.2 删除包（20 个，含理由）

| 包 | 上游用途 | 删除理由 |
|---|---|---|
| `app` | 主聊天 Web 前端（Vite+Solid，桌面 renderer） | 前端链；个人只用 TUI |
| `web` | Astro 官网（落地页/文档/分享查看页） | 营销站；依赖云端 api.opencode.ai |
| `ui` | Solid 基础组件库（markdown/code/diff/theme） | 前端链底层；TUI 自绘 |
| `session-ui` | 会话渲染组件库（app/enterprise 共享） | 前端链；无消费方 |
| `storybook` | Storybook 组件文档 | 仅前端开发用 |
| `desktop` | Electron 桌面应用 | 个人只用终端 |
| `enterprise` | SolidStart 企业版 Web（云分享 S3 + SST） | 企业级；云分享 |
| `console` | opencode.ai 云控制台 SaaS（六子包：计费/登录/用量） | 云账户/计费 |
| `identity` | 品牌 logo 资产 | 桌面/应用图标，无 runtime 用途 |
| `function` | Cloudflare Workers 云同步后端（Durable Object + R2） | 云端同步，与意图相反 |
| `stats`（站点） | opencode.ai 统计站点（AWS Athena + Honeycomb） | 云端分析平台；**≠ CLI `stats` 命令** |
| `slack` | Slack bot（转发会话 tool 事件） | 集成场景 |
| `cli` | OpenCode 2.0 preview CLI（代号 lildax，平台二进制） | 与主 CLI 并行的 v2 预览；fork 走主 CLI |
| `client` | Effect 版 SDK 客户端（httpapi-codegen 生成 promise/effect API） | 无消费方（sdk-next 已删） |
| `sdk-next` | 新版 Effect SDK 统一入口（组合壳，实现体在 client） | 无消费方 |
| `httpapi-codegen` | Effect HttpApi 代码生成器（client 构建期工具） | 仅 client（已删）使用 |
| `containers` | CI 容器镜像（ghcr.io） | CI 基础设施 |
| `script` | 发布/版本脚本库（channel/bump/registry） | CI/发布流程；≠ 根目录 `script/` |
| `docs` | Mintlify 文档站内容 | 上游文档站 |
| `effect-sqlite-node` | Effect SQLite Node 驱动（node:sqlite DatabaseSync） | fork 用 bun:sqlite 路径，自有 `sqlite.node.ts` 取代 |

> **注**：`client`/`sdk-next`/`httpapi-codegen` 是上游 SDK 三件套（client 生成、sdk-next 组合、codegen 生成器）。fork 的 `sdk`（legacy JS）由 `opencode generate` 直接产出，不需要这三件。若上游 SDK 体系重构导致 legacy `sdk` 不可维护，重新评估是否引入 `client`。

### 3.3 上游根目录其他内容

- `script/`：仅保留 `format`/`install`/`upgrade-opentui`/`dedupe-keymap`/`validate-e2e` + fork 的 `merge-clean`；删除 `beta`/`changelog`/`duplicate-pr`/`generate`/`publish`/`raw-changelog`/`stats`/`version`/`release`/`sign-windows`/`translate-app`/`github/`
- `specs/`：保留 `v2/`、`tui-package.md`；删除 `storage/`、`project.md`
- 删除目录：`artifacts/`、`nix/`、`sdks/vscode`、`.vscode`、`github/`、`Formula`、`sst-env.d.ts`、`sst.config.ts`、`turbo.json`、`flake.*`

---

## 4. 保留包内部架构（模块职责，改代码前先看）

### 4.1 依赖链总览

```
schema（类型真理）
  ├─→ protocol（API 契约） ──→ server（HTTP 实现） ──┐
  └─→ llm（LLM 传输） ──→ core（领域核心） ──────────┼──→ opencode（组合根/CLI）
effect-drizzle-sqlite ──→ core                      │        └──→ tui（终端 UI）
plugin（插件 API） ←── core（宿主）                    └──→ sdk（生成，被 tui/plugin 用）
```

### 4.2 各包模块

**`schema`**：`schema.ts`（基元）+ 领域文件（session*/event*/permission*/prompt*/question*/agent/model/provider/tool/project/workspace/location/filesystem/pty/reference/integration/credential/skill/command/catalog/plugin/event-manifest）+ `v1/`（遗留一代）

**`protocol`**：`api.ts`（组装）+ `groups/`（session/message/event/pty/provider/model/agent/command/permission/question/reference/fs/health/credential/integration/location/project-copy/skill）+ `middleware/`（authorization/schema-error）+ `errors.ts`

**`llm`**：`route/`（client/executor/auth/framing/transport）+ `protocols/`（openai-chat/openai-responses/anthropic/gemini/bedrock）+ `providers/`（厂商 profile）+ `schema/` + `llm.ts`（入口）

**`core`**（fork 改造最重）：
- `session/`：V2 核心（store/execution/runner/prompt/projector/compaction/context-epoch/history/run-coordinator）
- `tool/`：注册表 + 内置工具（bash/read/write/edit/apply-patch/glob/grep/webfetch/websearch/todowrite/question/skill）
- `permission/`：saved/sql + fork 新增 `SessionToolPermissions`（per-session 覆盖）
- `database/`：facade + drizzle schema + migration + 双运行时（bun/node）
- `filesystem/`：fff/ignore/protected/search/watcher
- `plugin/`：宿主（host/agent/command/provider）+ 30+ 厂商适配（fork 裁 7 家）
- `config/`：V2 配置（agent/provider/mcp/command/plugin/experimental）
- `control-plane/`：move-session、workspace.sql
- `v1/`：一代兼容（session/permission/config/migrate）
- `system-context/`：System Context 代数（index/registry/builtins）
- `event/`：EventV2 持久化；`bus.ts` = fork 改名（event.ts 桥接转发）
- `effect/`：Effect 基础设施（app-node/runtime/layer-node/keyed-mutex/memo-map）
- `observability/`：logging + shared（**otlp.ts 已删**）
- `subagent/`（**fork 特有**）：子代理 durable 管线（runner + executor）
- `memory/`（**fork 特有**）：context/store（dream.ts 已删）
- 支撑：agent/provider/model/catalog/command/integration/credential/pty/ripgrep/shell/process/git/snapshot/state/npm/repository/reference/instruction-context/location*/tool-output-store/background-job/id/image/installation/flag/policy/util

**`server`**：`api.ts` + `routes.ts`（服务组装）+ `handlers/`（与 protocol groups 对应）+ `middleware/` + `auth.ts`/`cors.ts`（fork 加固）/`location.ts`/`pty-environment.ts`

**`plugin`**：`index.ts`（v1）+ `tool.ts`/`shell.ts`/`tui.ts` + `v2/effect/`（主推：agent/aisdk/catalog/command/context/event/integration/plugin/reference/registration/skill；fork 新增 `ctx.event.subscribe`、`ctx.tool.hook`；已删 filesystem/location/npm/path 四死模块）+ `v2/promise/`

**`opencode`**（组合根）：
- `cli/`：`cmd/`（run/serve/tui/agent/attach/session/db/export/**import**/**stats**/generate/mcp/models/plug/providers/upgrade/uninstall/prompt-display/debug）+ bootstrap/network/error
- `server/`：`server.ts`（监听/生命周期）+ `routes/instance/httpapi/`（新一代 instance API：config/control/control-plane/event/file/instance/mcp/permission/project/provider/pty/question/session + handlers/middleware）+ `shared/`（fence/pty-ticket/public-ui/tui-control/workspace-routing）
- `config/`：用户配置（V2 写回 `opencode.json`）
- `session/`：应用层编排（session/prompt/llm/processor/compaction/summary/system/instruction/retry/revert/overflow/status）
- `permission/`：evaluate/arity（BashArity 前缀审批）
- `provider/`：provider/auth/error/transform/model-status
- `mcp/`：catalog/oauth-callback/browser + fork v2 接入
- `project/`：project/bootstrap/instance-*/vcs
- `control-plane/`：workspace（**远程同步已删**，本地 worktree 保留）
- `tool/`：应用层工具（apply_patch/edit/glob/grep/lsp/plan/question/code-mode）
- `effect/`：运行时组装（app-runtime/bridge/config-service/instance-*/run-service/runner）
- 其他：bus/command/env/format/git/lsp/patch/question/skill/snapshot/storage/worktree/util

**`tui`**（fork 打磨最重）：
- `component/`：command-palette/spinner/logo/todo-item/startup-loading/dialog-*/prompt/
- `routes/`：home + session/（index/permission/question/subagent-footer + dialog-*；sidebar/footer/dialog-subagent 已删，交互整合进 index）
- `feature-plugins/`：builtins + home/（footer/tips）+ system/（diff-viewer/which-key/notifications/plugins）；**sidebar/ 已全删**
- `context/`：data/sdk/event/prompt/permission/project/location/theme/route/runtime/sync/args/clipboard/editor/thinking
- `ui/`：dialog + dialog-*/link/spinner/toast/border + fork 新增 `glyphs.ts`
- `util/`：transcript/format/layout/model/session/scroll/selection/tool-display/revert-diff/collapse-tool-output/persistence/presentation + fork 新增 `markdown.ts`
- `prompt/`：display/frecency/history/part/stash/traits；`config/`（index/keybind）；`theme/`；`plugin/`（runtime/api/adapters/slots/command-shim）

**`sdk`**（js）：`openapi.json`（由 generate 产出，不追踪）+ `js/src/gen/`（v1）+ `js/src/v2/`（v2）+ `js/script/build.ts`（重新生成入口）

**`codemode`**：codemode.ts + interpreter/（model/runtime）+ stdlib/（12 受限模块）+ openapi/ + tool*

**`http-recorder`**：recorder/cassette/matching/redaction/effect/socket/websocket

**`effect-drizzle-sqlite`**：effect-sqlite/（driver/session/migrator）+ sqlite-core/effect/ + up-migrations/

---

## 5. 决策留档（后续审计参照）

### 5.1 Rust napi 基准结论（Batch 1~2）

原 6 Rust napi + 1 Zig WASM 模块经 3 轮基准（速度/冷启动/并发/可扩展性/事件循环阻塞/内存/CPU/线程模型）后全删：

```
模块           │ 速度 vs TS │ 线程模型 │ 内存 │ 体积 │ 结论
grep          │ 🟢快10000x │ 🟢async │ 🟡中 │ 🟡0.3MB│ 曾保留，后跟随上游 ripgrep
glob          │ 🔴慢 2x    │ 🔴sync  │ 🟡中 │ 含上 │ 删
sqlite        │ 🔴慢 5.5x  │ 🔴sync  │ 🟡中 │ 🔴2.6MB│ 删
prompt-builder│ 🔴慢 8x    │ 🔴sync  │ 🟢小 │ 🔴0.9MB│ 删
tiktoken      │ 🟡不定     │ 🔴sync  │ 🔴大 │ 🔴5.9MB│ 删
SSE           │ 🔴慢 5.4x  │ 🟢async │ 🟡中 │ 🔴4.0MB│ 删
```

**原则**：Rust napi-rs 仅在「消除子进程开销且 Rust 算法显著更快」时提供价值；Bun 原生 API（bun:sqlite/Bun.Glob/fetch）在其余场景更快且不阻塞事件循环。

### 5.2 待复审/已裁决项

| 项 | 裁决 | 状态 |
|---|---|---|
| `cli/cmd/stats.ts` | 纯本地统计，恢复 | ✅ 已恢复（2026-08-03） |
| `cli/cmd/import.ts` | 本地文件导入恢复，URL 分享导入裁剪（云依赖） | ✅ 已恢复（2026-08-03） |
| `core/src/oauth/page.ts` | 删除依据曾误记「上游已删」，实为 fork 自删；功能已被内联 escapeHtml 替代，维持删除 | 维持删除 |
| `core/src/session/context-levels.ts` | 非死代码，是 fork 新增 V2 压缩模块（仅 `estimateRequestTokens` 导出被删） | 存活 |
| `cli/cmd/pr.ts` | GitHub 协作场景，轻依赖 | 维持删除 |
| `cli/cmd/acp.ts` | ACP 协议服务器，进阶集成用 | 维持删除 |
| `server/mdns.ts` | 局域网发现 | 维持删除 |
| `cli/cmd/web.ts` | 无 web 包时退化为云代理 UI | 维持删除 |
| `core/src/github-copilot/` | Copilot 订阅用户有用，上游自认临时包 | 维持删除 |

---

## 6. 历史阶段（已完成）

- **Batch 0**：fork + graft 基线 + 裁剪 20 包 + 删 artifacts/github/nix/sdks/specs/storage + 切 Bun
- **Batch 1~2**：Rust napi 基准测试后全删（§5.1）
- **Batch 3**（6 子批）：B1 死 SDK 包与根依赖；B2 云账户/sync/share；B3 OpenTelemetry 拔除；B4 GitHub Copilot + OAuth 页；B5 Bedrock/Cloudflare；B6 Web UI purge + 音效重定位
- **TUI 审计打磨**：四批 23 轮（类型安全/floating promise/死代码/oxlint + 主题/间距/文案/空态/动效）
- **TUI 渲染深度打磨**：代码块面板化/流式防闪/reasoning markdown/盲文 spinner/GLYPH 统一/subagent 身份色
- **安全加固**：XSS 修复（4 处 OAuth 回调 escapeHtml）、测试套件修复、6 项 NEEDS-JUDGMENT 维持现状
- **深度优化 7 批次**：投影器 O(n²)→O(n)、历史增量加载、事件微批、HTTP 超时/重试、流式压缩、SQLite 优化、PTY 有界队列、CORS/auth 加固
- **2026-08-02**：workspace 远程同步移除（-1624 行）、PTY 有界队列补全、安全修复二/三批
- **2026-08-03**：V2 全量审计校验、TUI 打磨、全包架构审计、`stats`/`import` 恢复
