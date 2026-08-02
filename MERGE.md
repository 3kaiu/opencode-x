# Merge 策略

## 背景

opencode-x 是基于 [anomalyco/opencode](https://github.com/anomalyco/opencode) 的精简 fork，需要定期合并上游更新。首次同步时 fork 与 upstream/dev 在不同的根提交上分叉，需要通过 graft 建立共同的基线。

自裁剪工程收尾后，合并进入**审计式吸收**常态：每次 sync 只提取并比对上游的新特性与问题修复，保留更新、更有用的实现；双方共改的模块通过对抗审计裁决最优实现。

### 项目意图（合并决策的最高准绳）

- **只为个人 agent 终端使用而存在**：裁掉云端/sync/share/OTEL/Copilot/desktop/Web/企业化/无消费的 SDK 等一切与个人 CLI 无关的部分。上游若在这些方向上演进，一律按第 ① 类丢弃。
- **只删不改架构**：不主动重构上游架构，精简聚焦；跟随上游纯重构以降低未来冲突面。
- **长期跟踪上游、永不脱轨**：随上游 release 触发审计式吸收，保持可持续合并能力。
- **一切偏离必须审计验证**：任何删除/保留/自有改进都以对抗审计（并排比较、基准测试）为依据，并登记到「fork 偏离清单」。
- **持续打磨 TUI 到一流水准**：参照 Claude Code / Qoder / Kimi，动效克制且可关；Knight-Rider 提示扫描动画不动。
- **PLAN.md 与 MERGE.md 是活文档**：随事实演进，每次 sync 后强制复核（见「sync 收尾清单」）。

## 远程配置

```bash
git remote add upstream https://github.com/anomalyco/opencode.git
git fetch upstream
```

## 首次合并流程（graft + merge）

```bash
# 1. 找到 fork 与 upstream 的共同基线（fork 基于的 upstream 版本 tag）
BASELINE=v1.18.2
# 2. 记录 fork 的第一个提交（root commit）
ROOT=$(git log --oneline --all | tail -1 | awk '{print $1}')
# 3. 建立 graft：让 git 认为 root 的父级是 baseline tag 的 commit
git replace --graft "$ROOT" "$BASELINE"
# 4. 验证 graft
git log --oneline --all --graph --decorate | head -20
# 5. 合并
git merge --no-ff upstream/dev --no-edit
```

> **注意**：`git replace --graft` 是本地操作，不影响远程仓库。clone 到新机器时需要重新执行 graft。

## 常规合并流程

```bash
git fetch upstream
git merge --no-ff upstream/dev --no-edit
# 若存在 graft，需要先执行：git replace --graft "$ROOT" "$BASELINE"

# 合并后：清单驱动地重新删除上游带回的已删路径，并扫描残留接线/禁用依赖
bun script/merge-clean.ts          # 自动 git rm + 报告
bun script/merge-clean.ts --check  # 只报告不删除
```

脚本退出码非 0 时表示存在需要手工处理的残留（禁用依赖回到 package.json、接线代码重新出现），按输出逐项处理后重跑。删除清单、禁用依赖、残留扫描模式都维护在 `script/merge-clean.ts` 顶部，调整删除范围时同步更新脚本与本文档。

## 审计式吸收流程（每次 sync 的核心）

merge 产生的每一处差异/冲突，按以下五类分诊。原则：**只提取比对新特性与问题修复，保留更新的、更有用的**。

### ① 落在已删模块的变更 → 自动丢弃

上游对已删包/已删文件的任何修改，由 `bun script/merge-clean.ts` 自动 `git rm` 保留删除，零人工。若上游为已删模块新增了**接线代码**（import/注册），脚本残留扫描会报告，手工移除接线。

### ② 上游 bug 修复 → 默认吸收

位于保留模块的 bug 修复直接取上游版本。若修复落在 fork 已偏离的代码上，视为第 ④ 类处理。

### ③ 上游新特性 / 新包 / 新依赖 → 用途审计

不可无条件引入，也不可无条件删除。逐项审计用途：

- **个人 agent 有用**（如曾经的 `http-recorder`、`effect-drizzle-sqlite`）→ 引入
- **企业类 / 云端 / 遥测 / 应用 UI / CI 基础设施 / 无消费方的 SDK 层** → 拒绝，并将路径加入 `merge-clean.ts` 删除清单 + 本文档已删列表
- **暂无法判断** → 引入但标记观察；下次 sync 复审，仍无使用价值则删除

新增原生模块（Rust/Zig）一律按 PLAN.md 的「Rust napi 适用性原则」基准测试后再决定。

### ④ 双方共同修改的模块/功能 → 对抗审计

fork 与上游改了同一处（常见于 TUI 视觉/UX、core 加固逻辑）时，并排比较两个实现，按以下优先级裁决：

1. **正确性**（是否修复了真实缺陷、边界处理是否完整）
2. **行为完整性**（功能覆盖面、状态处理：空态/加载/错误/降级）
3. **性能**（有争议时用基准测试说话，不凭直觉）
4. **可维护性**（与代码库惯例一致、依赖更少、更易跟随上游演进）
5. **契合精简原则**（不引入 fork 不需要的配套复杂度）

裁决结果三选一：**取上游** / **保留 fork** / **融合两者**。凡「保留 fork」或「融合」的，必须在下方偏离清单登记（文件、内容、理由），供下次 sync 复审。

### ⑤ 上游纯重构（无行为变化）→ 默认跟随

跟随上游重构可持续降低未来冲突面。例外：重构会把已删模块重新接线、或破坏 fork 的删除边界时，按第 ① 类处理其接线部分。

### 偏离清单生命周期

偏离清单是**活文档**，每次 sync 后必须回写：

- 上游已实现同等或更好的改进 → 取上游版本，**移除**该条目
- 偏离的载体文件已被删除 → **移除**该条目
- 新的对抗审计裁决 → **新增**条目
- 与 `script/merge-clean.ts` 顶部清单保持同步

## 冲突解决注意事项

### 经验教训

1. **禁止 blanket `git rm`**。首次合并时因冲突过多，执行了 `git rm -r --cached packages/` 意图删除已移除包，结果误删了仍在使用的 `package.json`、10+ 个子包 `package.json` 以及 `bun.lock`。必须后续 commit 恢复。
2. **解决冲突时应按文件逐个处理**。使用 `git mergetool` 或手动编辑。批量命令（`git rm`/`git add .`）容易引入竞态问题。
3. **`bun.lock` 在合并后必须重新生成**：`bun install`。不要手动编辑或试图合入 `bun.lock`。
4. **合并后应先提交冲突解决，再处理细节修复**。
5. **每个合并必须保留 graft 的引用记录**。在 commit message 中标注 baseline 版本号：`chore: sync upstream to <baseline>`。

## fork 偏离清单

> 每条注明处理方式；标注「上游若已做可取上游版本」的条目在每次 sync 时复审。数据基于 v1.18.2→v1.18.4 sync、后续 v1.18.6/v1.18.7/v1.18.8 sync 与 fork 自有改进（含 TUI 渲染深度打磨），随每次 sync 更新。

### 结构性偏离（删除保持）

| 冲突来源 | 频率 | 处理方式 |
|---------|------|---------|
| `packages/{app,desktop,session-ui,slack,enterprise,web,function,console,stats,containers,identity,storybook,httpapi-codegen,docs,ui,cli,client,sdk-next,native-bridge,script}/` | 每次 | `bun script/merge-clean.ts` 自动 `git rm` 保留删除 |
| `packages/opencode/src/{acp,account,sync,share,plugin/github-copilot}/`, `cli/cmd/{github.*,pr,web,acp,import}.ts`, `server/mdns.ts`, `packages/core/src/{github-copilot,oauth,observability/otlp.ts}` | 每次 | `bun script/merge-clean.ts` 自动 `git rm` 保留删除（CLI-only 定位/云端/账号/遥测/Copilot 物理拔除） |
| `packages/core/src/plugin/provider/{amazon-bedrock,cloudflare-*}.ts` | 每次 | `bun script/merge-clean.ts` 自动 `git rm` 保留删除（已裁剪 Provider） |
| `packages/tui/src/routes/session/{sidebar,footer,status-bar,dialog-subagent}.tsx`, `feature-plugins/sidebar/*`, `component/{curve-spinner,dialog-tag}.tsx`, `component/prompt/cwd.ts`, `ui/primitives.tsx`, `util/{animation,curve-engine,layout,responsive}.ts` | 中 | 保留删除（TUI 死代码审计裁定）；若上游重新接线并赋予实际功能，对抗审计重新评估 |
| `@opentelemetry/*`, `@openauthjs/*` 依赖 | 每次 | 不合入，保持依赖瘦身 |
| `bun.lock` | 中 | `bun install` 重新生成，不手动编辑 |
| `package.json` (workspaces) | 低 | 手动合入，保持仅保留包的 workspace（见已删包列表） |
| `packages/opencode/package.json` (依赖) | 中 | 手动合入，保留 opencode-x 特有依赖；已删 `@actions/*`、`@octokit/*`（含 `@octokit/webhooks-types` devDep）、`@agentclientprotocol/*`、`bonjour-service`、`chokidar`、`@gitlab/opencode-gitlab-auth`（无前缀的 `opencode-gitlab-auth`、`gitlab-ai-provider` 保留） |
| `packages/core/package.json` (依赖版本) | 中 | 手动合入，保留 opencode-x 特有依赖 |
| `packages/opencode/src/index.ts` (cmd 注册) | 中 | 手动合入，保持已删命令的注册移除 |
| `packages/opencode/src/server/server.ts` (mdns 移除) | 低 | 保留 mdns/setupMdns 移除 |
| `packages/opencode/src/cli/network.ts` (mdns 选项移除) | 低 | 保留 mdns/mdns-domain 选项与解析移除，返回值仅 `{ hostname, port, cors }` |
| `packages/opencode/src/cli/{cmd/tui.ts,tui/worker.ts}` (mdns 参数移除) | 低 | 保留 --mdns 检查项与 worker server 签名的 mdns 移除 |
| `packages/opencode/src/project/bootstrap.ts` (ShareNext 移除) | 中 | 保留 ShareNext import/init/deps 移除 |
| `packages/tui/src/config/keybind.ts` + `routes/session/index.tsx` + `feature-plugins/home/tips-view.tsx` (share 命令接线移除) | 中 | 保留 session_share/session_unshare keybind、share/unshare 命令、share 提示文案移除 |
| `packages/opencode/test/cli/help/help-snapshots.test.ts` (命令清单) | 中 | 保留 acp/web/import/github/pr/stats 从 TOP_LEVEL/SUBCOMMANDS 移除；快照变化时删除 `.snap` 后 `bun test test/cli/help` 重生成 |
| `packages/opencode/{src/cli/cmd/account.ts, server/routes/instance/httpapi/groups/sync.ts}` + 关联测试 (`test/{account,fake/account.ts,cli/account.test.ts,server/httpapi-sync.test.ts,plugin/github-copilot-models.test.ts,plugin/cloudflare.test.ts}`) | 每次 | `bun script/merge-clean.ts` 自动 `git rm` 保留删除（账号/sync 已裁剪，本轮补入 merge-clean 清单 `removedOpencodePaths` + `residualScans`） |
| `packages/opencode/test/plugin/auth-override.test.ts` (内置 auth 覆盖机制测试) | 低 | 保留将测试目标从已删的 github-copilot 内置 auth 改为存活的 xai（`provider: "xai"`，断言 `methods[xai]`/`plainMethods[xai][0].label`）；机制不变，仅换载体 provider |
| `packages/opencode/src/server/routes/instance/httpapi/handlers/session.ts` (share/unshare 移除) | 中 | 保留 share/unshare handler 和 SessionShare import 移除 |
| `packages/opencode/src/server/routes/instance/httpapi/groups/session.ts` (share/unshare endpoint 移除) | 中 | 保留 share/unshare endpoint 和 SessionPaths.share 移除 |
| `packages/opencode/src/cli/cmd/run.ts` (--share 选项移除) | 中 | 保留 --share 选项和 share() 函数移除 |
| `packages/opencode/src/effect/{app-runtime,bootstrap-runtime,runtime-flags}.ts` (share layer 移除) | 中 | 保留 ShareNext/SessionShare/autoShare 移除 |
| `packages/opencode/src/session/session.ts` (share_url 字段保留) | 中 | 保留 `share_url` 读写（DB 兼容，fork 删 share 模块但保留 schema 列） |

### 行为与加固偏离（core / opencode）

| 冲突来源 | 频率 | 处理方式 |
|---------|------|---------|
| `packages/core/src/observability.ts` | 低 | 保留 `Layer.empty` 修复 |
| `packages/opencode/src/session/retry.ts` (RETRY_MAX_DELAY cap) | 中 | 保留 `RETRY_MAX_DELAY = 300_000`（上游默认 2^31-1） |
| `packages/opencode/src/cli/cmd/run/stream.transport.ts` (MAX_BUFFERED cap) | 中 | **2026-08-02 复核修正**：`MAX_BUFFERED = 500` + `pushBuffered()` helper 曾在 fork commit `4c7306cc2f` 引入、后被上游 merge 静默丢弃（MERGE 旧登记失真）。本轮已恢复：`buffered` 超 500 时裁掉最旧事件，防非跟踪会话事件无界积累；`fail()` 内联 `input.footer.append({ kind: "error" })` 已随上游演进移除，旧登记中该半句一并删除（上游若已做可取上游版本） |
| `packages/core/src/ripgrep.ts` + `packages/core/src/tool/grep.ts` (执行超时 + 有界行框界 + grep 默认 limit) | 中 | 保留 `run()` 的 `DEFAULT_TIMEOUT = 30s`（`Effect.timeoutOrElse` 复用 `Ripgrep.Error`，超时关 scope 杀子进程）+ `Find/Glob/Grep` 可选 `timeout?` 覆盖；`splitBoundedLines(MAX_RECORD_BYTES)`（`Stream.mapAccum` 单行永不超 64KB 缓冲，grep 截断 JSON 记录沿用失败语义、find/glob 超长行跳过不失败）；`filesystem/search.ts` 后台全仓索引显式 `timeout: "10 minutes"`；grep 工具 `DEFAULT_LIMIT = 100`（替换 `Number.MAX_SAFE_INTEGER`）（上游若已做可取上游版本） |
| `packages/core/src/{event.ts => bus.ts}` (纯改名) | 低 | 纯改名：EventV2 实现整体从 `event.ts` 移入新文件 `bus.ts`（内容逐字节等价，仅头部自导出行移动），`event.ts` 收敛为转发桥接单行 `export * as EventV2 from "./bus"`；全部导入方经 `EventV2` 引用，改名对调用方透明。**未包含**任何行为改动：`durable()` historical 仍为整数组加载、`readAfter` 仍为无界 `.all()`、`pubsub.durable` 仍为 `Map<string, Set<PubSub>>`。durable-tail 分页 + `RcMap` wake 简化仍是待办（`specs/v2/todo.md`），尚未实现（上游若已做可取上游版本） |
| `packages/core/src/database/migration.ts` (跨进程 claiming 竞态闭合) | 中 | 保留把"是否已应用"判定移入每条 migration 的 immediate 写事务内（`applyOnly` 事务内 `SELECT id ... WHERE id = ?` 复核后再 `up`；bootstrap 路径 `CREATE TABLE IF NOT EXISTS migration` + 事务内 `sqlite_master` 查 `session` 表复核，命中则降级 `applyOnly`）；沿用 `INSERT OR IGNORE` 幂等写入与模块级 `Semaphore`（进程内串行）（上游若已做可取上游版本） |
| `packages/core/src/database/database.ts` (并发冷启动健壮性) | 中 | 保留 `PRAGMA busy_timeout = 5000` 前置于 `journal_mode = WAL`；WAL 排他切换加有界重试 `Schedule.exponential(25).pipe(jittered, while elapsed<5s)`，避免两进程冷启动同一文件时 `SQLITE_BUSY`（上游若已做可取上游版本） |
| `packages/opencode/src/cli/cmd/run/footer.prompt.tsx` (@ 补全 debounce) | 低 | 保留 `debouncedQuery` 100ms debounce（上游若已做可取上游版本） |
| `packages/opencode/src/cli/cmd/run/theme.ts` (muted 灰度对比度提升) | 低 | 保留 dark mode gray 200/220（上游若已做可取上游版本） |
| `packages/opencode/src/{plugin/openai/codex.ts,mcp/oauth-callback.ts,plugin/xai.ts,plugin/snowflake-cortex.ts}` (OAuth 回调 HTML 转义) | 中 | 保留 `escapeHtml()` 包裹 `error`/`error_description` 插值。上游删除 `core/src/oauth/page.ts`（统一转义页）后，fork 内联的 `Authorization failed: ${error}` 存在反射型 XSS；补 `@/util/html` 转义修复（上游若恢复统一转义页可取上游版本） |
| `packages/core/src/database/sqlite.node.ts` (Node 驱动语句缓存) | 中 | 保留 `Map<string, StatementSync>` LRU 缓存（`MAX_CACHED_STATEMENTS = 1000`），避免重复 prepare；移除冗余 `PRAGMA journal_mode = WAL`（统一到 `database.ts`）（上游若已做可取上游版本） |
| `packages/server/src/handlers/pty.ts` + `packages/opencode/src/server/routes/instance/httpapi/handlers/pty.ts` (PTY WebSocket 有界队列) | 低 | 保留 `Queue.dropping(1024)` + 溢出断连（防无界内存增长），上游 `unbounded` 存在长会话内存泄漏风险。**2026-08-02 补全**：此前仅有独立 server 面有界，fork 实例面（CLI/TUI 实际走 `PtyConnectApi` 的路径）仍是 `unbounded`，本轮对齐为 `dropping(1024)` + overflow 断连（上游若已做可取上游版本） |
| `packages/server/src/cors.ts` (CORS origin 精确匹配) | 低 | 保留精确正则匹配（`^https?:\/\/(localhost|127\.0\.0\.1):(\d+)$`）替代 `startsWith`，防 origin 欺骗（上游若已做可取上游版本） |
| `packages/server/src/auth.ts` (timing-safe 密码比较) | 低 | 保留 `crypto.timingSafeEqual` + 长度前置检查，防时序攻击（上游若已做可取上游版本） |
| `packages/core/src/control-plane/workspace.sql.ts` (project_id 索引) | 低 | 保留 `index("workspace_project_idx").on(table.project_id)`，加速 workspace 按 project 查询（上游若已做可取上游版本） |
| `packages/core/src/catalog.ts` (`available()` 接受 `api.settings.apiKey`) | 中 | 保留：V1 config 迁移把 `options.apiKey` 降为 `api.settings.apiKey` 且注册无连接的 env integration，导致可用性判定与模型解析（`session/runner/model.ts`）不一致、v2 写路径 `ModelUnavailableError`；回归测试 `packages/core/test/catalog.test.ts`（derives availability from api settings apiKey）；配套 fork 新增影子对比 harness `packages/opencode/test/server/session-shadow.test.ts`（v1/v2 写路径 parity）（上游若已做可取上游版本） |
| `packages/opencode/src/session/prompt.ts` (v1 prompt 桥接 v2 读投影) | 中 | 保留：`prompt()` 在 `experimentalEventSystem` 下发布 `session.next.prompted` + 每个 synthetic 文本部分一条 `session.next.synthetic`，使 v1 会话对 `SessionV2.messages`（`session_message` 投影）可见；实现的是上游被跳过测试 `test/session/prompt.test.ts`「prompt emits v2 prompted and synthetic events」定义的合同（已解除 skip），并同步改写「legacy prompt ... without session.next events」为桥接后合同（上游若实现同等桥接则取上游版本并还原测试） |
| `packages/schema/src/session-event.ts` + `packages/core/src/session/runner/llm.ts` (v2 drain 失败 live 事件 `session.next.failed`) | 中 | 保留：新增 live-only `SessionEvent.Failed`（不入 durable manifest/不投影），`SessionRunner.run` 失败（非纯中断 cause）时发布，覆盖 step 开始前的失败（如 `ModelUnavailableError`）——此前 drain 失败仅 `execution/local.ts` logError，客户端不可见；step 内失败仍由 durable `Step.Failed` 结算（会双发，与 v1 `session.error` + assistant error 双通道一致）；测试 `packages/core/test/session-runner.test.ts`（publishes a live failed event when a drain fails）；连带更新 manifest 计数测试（schema 侧原本在 HEAD 即过期失败，修正为真实计数；**2026-08-02 复核：当前实测 Latest=99 / ServerDefinitions=69 / Durable=42，行 166/170/206 的 89/59/35、60/90/90/36 计数表述均已过期，以本行与 `packages/schema/test/event-manifest.test.ts` 锁定值为准**）+ SDK v2 重新生成（上游 runner 若补 durable 状态事件则取上游版本并移除本事件） |
| `packages/tui/src/context/sdk.tsx` + `packages/sdk/js/src/v2/gen` (移除残留 `/sync/*` SDK 面) | 低 | 保留：fork 早前裁剪了 server `/sync/*` 路由，但 SDK gen 与 TUI `sdk.sync.start()`（实验 flag 下静默 404）未同步；本次 SDK 重新生成后一并删除 TUI 调用点（上游 sync 面回归时随上游恢复） |
| `packages/core/src/{session.ts,session/compaction.ts,session/history.ts,session/runner/*}` (v2 手动 compact 实现) | 中 | 保留：实现 `SessionV2.compact`（原 stub 恒 `OperationUnavailableError`），spec `specs/v2/session.md:105` 已列为 sanctioned improvement。`SessionCompaction.make` 抽出共享 `summarize` 核心（`reason: "auto"\|"manual"`），新增 `compactManually`（输出预算取 `model.route.defaults.limits?.output`，可选 `instructions` 折入 `buildPrompt`）；`SessionHistory.load` 改由新导出 `entries()`（读 epoch `baseline_seq` 只读，不触发 SystemContext 初始化）派生；`SessionRunner` 接口新增 `compact`，`SessionV2.compact` 经 `locations.get(session.location)` 路由，失败/无可压缩内容统一映射 `OperationUnavailableError`（HTTP 503 文案不变）。已知限制：手动 compact 不经 `SessionRunCoordinator` 串行化，与进行中 drain 并发时下一 turn 才生效；测试 `packages/core/test/session-runner.test.ts`（manually compacts on demand / returns false when nothing to compact）（上游实现 v2 手动 compact 后取上游版本） |
| `packages/core/src/{session.ts,session/run-coordinator.ts,session/execution.ts,session/execution/local.ts}` (v2 `SessionV2.wait` 实现) | 低 | 保留：实现 `SessionV2.wait`（原 stub 恒 `OperationUnavailableError`）。逐字对齐上游 in-flight 提交 `5e90a68d6a`（wip(core): v2 subagent foundations）：`SessionRunCoordinator.awaitIdle`（await entry `done` + `Effect.exit` 吞掉失败/中断、循环复查 successor 直到 idle，空闲即 no-op、不发起 drain），`SessionExecution.awaitIdle` 透传，`SessionV2.wait` 委托并收窄为 `NotFoundError`，server handler 移除死的 503 映射，literals 移除 `"wait"`（对齐 `bd8d858bf7` 前态）。语义限制：仅覆盖本进程持有的执行；测试为 fork 补充（上游 wip 无测试）：`packages/core/test/session-run-coordinator.test.ts`（awaitIdle 4 例）+ `packages/opencode/test/server/httpapi-session.test.ts`（wait 改期望 204）（上游该分支合入后按上游版本对齐） |
| `packages/{schema,core,protocol,server}/src/**` + `packages/sdk/js/src/v2/gen` (v2 `SessionV2.skill` 实现) | 中 | 保留：实现 `SessionV2.skill`（原 stub 恒 `OperationUnavailableError`）。逐字移植上游 in-flight 提交 `23adaaaeab`（feat(core): add native skill activation）：durable `SessionEvent.Skill.Activated` + `SessionMessage.Skill` + projector/message-updater/to-llm-message/compaction 全链路，`SessionV2.skill` 经 `locations.get(session.location)` 解析 `SkillV2.list()`、未命中报 `Session.SkillNotFoundError`、`resume !== false` 时 fork `execution.resume`，协议新增 `POST /api/session/:sessionID/skill`（404 `SkillNotFoundError`）+ server handler + SDK v2 重新生成。未移植部分：TUI skill UX（依赖上游更新的 useLocation 管线）、report skill、cli daemon、plugin skill.ts、packages/client gen。测试为 fork 补充：`packages/core/test/session-create.test.ts`（activates a known skill as a durable skill message）+ httpapi-exercise/httpapi-session 覆盖；manifest 计数随 durable 事件 +1（60/90/90/36）（上游该分支合入后按上游版本对齐） |
| `packages/{core,protocol,server}/src/**` + `packages/sdk/js/src/v2/gen` (v2 `SessionV2.shell` 实现) | 中 | 保留：实现 `SessionV2.shell`（原 stub 恒 `OperationUnavailableError`）。结构逐字对齐上游提交 `bd8d858bf7`（feat(core): implement V2 session.shell）：`KeyedMutex` 按 Session 串行、`activeShells` 抑制 shell 期间 prompt wake、`execution.awaitIdle` 等待在跑 drain、durable `Shell.Started`/`Shell.Ended`（事件在 HEAD 已入 manifest，计数不变）、`Effect.ensuring` 清理 + `execution.wake`，协议新增 `POST /api/session/:sessionID/shell`（404 `SessionNotFoundError`）+ server handler + SDK v2 重新生成。唯一偏离：`runShellCommand` 内部用 HEAD 已有原语 `AppProcess.run` + `Shell.preferred`/`Shell.args`（v1 用户 shell 语义：config shell、TERM=dumb、extendEnv、stdin ignore、forceKillAfter 3s、合并输出、1MiB 截断、`AppProcessError` 捕获为输出文本）替代上游尚未移植的 location `Shell.Service`（`5ae93092aa`）；`core/src/shell.ts` 保持原样。测试为 fork 补充：`packages/core/test/session-create.test.ts`（shell 3 例）+ httpapi-exercise/httpapi-session 覆盖（上游 `5ae93092aa`+`bd8d858bf7` 移植后取上游版本） |
| `packages/core/src/v1/config/migrate.ts` (v1 provider 可用性列表 → v2 策略迁移) | 低 | 保留：补全 V1 `disabled_providers`/`enabled_providers` → `experimental.policies` 的 `provider.use` 降级。此前 `isV1` 识别这两个键但 `migrate()` 静默丢弃，V1 deny/allowlist 加载即丢失。新增 `experimental()` helper，映射顺序按 `specs/v2/provider-policy.md:248-291`：disabled→逐条 deny；enabled→`deny *`+逐条 allow；显式 `experimental.policies` 后置（last-match-wins 下显式优先）。测试 `packages/core/test/config/config.test.ts`（migrates legacy provider availability lists into policies）。属规格已规定的正确性修复，偏离面小（上游若实现同等迁移则取上游版本） |
| `packages/core/src/session/runner/model.ts` (v2 runner 原生 Google/Gemini 路由) | 中 | 保留：`fromCatalogModel` 新增 `@ai-sdk/google` → `Gemini.route` 原生分支（`x-goog-api-key` 头鉴权），`supported()` 纳入该包；复用 `packages/llm` 已有 `Gemini.route`，零新协议。测试 `packages/core/test/session-runner-model.test.ts`（maps Google→Gemini route / x-goog-api-key auth / supported）。**热点区**：落在 sync 清单 `session/runner/*` 上游高频重构区，上游若原生支持 Google 则取上游版本并移除本条目 |
| `packages/plugin/src/v2/effect/{context,event,index}.ts` + `packages/core/src/plugin/host.ts` (插件 `ctx.event.subscribe`) | 中 | 保留：实现 PLAN.md 阶段 8 的插件事件订阅。经 `EventManifest.Latest`（SDK 事件类型字符串与内部 `definition.type` 同名）解析订阅，payload 经 `Schema.encodeUnknownSync` 编码为 SDK 形状（进程内订阅者与远程 SDK 消费者拿到一致 encoded 侧），非 EventV2 定义的 SDK 类型（如 `server.instance.disposed`）返回空流。effect `PluginContext` 增 `event` 成员并导出 `Event`/`EventMap`。测试 `packages/core/test/plugin.test.ts`（delivers encoded events to plugin subscribers）（上游若实现插件事件适配器则对抗审计，上游若已做可取上游版本） |
| `packages/plugin/src/v2/effect/{context,tool,index}.ts` + `packages/core/src/plugin/host.ts` + `packages/core/src/session/hooks.ts` (插件 `ctx.tool.hook` 运行时钩子) | 中 | 保留（**待复审**）：新增插件 `ctx.tool.hook("execute.before"/"execute.after")`，桥接到 runner 实际调用的 `SessionHooks`（before 支持 `args.update`/`deny`/`skip`，after 支持 `context.add`）；`SessionHooks.register*` 改为 scope-owned（`Effect.addFinalizer` 卸载，插件移除即注销）。`PluginV2.node` 增 `SessionHooks.node` 依赖。测试 `packages/core/test/plugin.test.ts`（registers tool execution hooks through the plugin context）。**注意**：CONTEXT.md「Flagged ambiguities」将「V2 plugins 是否暴露等价 hook」列为「Decide separately」的搁置设计问题；本实现先行落地（本地先行），下次 sync 须复审是否应改为插件定义 Context Source 或收窄语义（上游若给出官方 hook 设计则取上游版本并移除本条目） |
| `packages/core/src/session/tool-permissions.ts` + `session/runner/llm.ts` (per-session 工具权限覆盖接缝) | 低 | 保留（fork 自有，本地先行 B 路线基础）：新增 Location 作用域 `SessionToolPermissions`（sessionID→`PermissionV2.Ruleset` 内存 map），runner 在 `tools.materialize` 前先查覆盖、缺省回退 `agent.info.permissions`。为子代理改走 durable 管线后保留「无显式权限则只读」（`SUBAGENT_READONLY_RULES`）的 fork 安全默认而设（durable runner 原生只用 agent 权限，无 per-session 注入缝）。**已接线**：`llm.ts:330` 消费、`subagent/runner.ts:315` 设置（前台/后台均清理）；`SUBAGENT_READONLY_RULES` 动作名修正为 `websearch`/`webfetch`。上游若提供 per-session 工具权限机制则取上游版本 |
| `packages/{schema,core,server,opencode}/src/**` (v2 子代理事件解耦 durable 管线) | 中 | 保留（**fork 抢先，接受偏离，上游合并时收敛**）：`delegate_task` 子代理改走 durable 管线。location 作用域 `SubagentRunner` 不能静态依赖全局 `SessionV2`（`SessionV2 → LocationServiceMap → location图` 成环），故新增两个 **live** 事件 `session.next.subagent.requested`/`.result`（非 durable、不入 manifest 计数）：`SubagentRunner` 设只读覆盖（`SessionToolPermissions`）后发 `Requested` 并等 `Result`；新增**全局** `SubagentExecutor`（`subagent/executor.ts`，`EventV2.subscribe` 异步消费、后台 fiber 经 `SessionV2.create→prompt→wait→读投影` 驱动子会话，回发 `Result` + durable `Spawned/Completed`），接在 `packages/server/routes.ts` 与 opencode instance server（与 `SessionV2.node` 同组）。镜像 fork 现有「location runner 被全局 `SessionExecution` 驱动」模式。支持 `background` 模式：`delegate_task` 传 `background=true` 时 `SubagentRunner` 发 `Requested` 后立即返回 `running`，执行器经 `BackgroundJob` 跟踪该子代理、驱动完成后把结果以 steer prompt 注入父会话。**已接线生产**：`subagent/executor.ts` 全局执行器已加入 `opencode/src/server/routes/instance/httpapi/server.ts` 的 `SessionV2` 同组组合（此前仅测试引用，`delegate_task` 前台超时/后台永不返回）；`Requested/Result` 两个 live 事件已加入 `SessionEvent.Definitions`（SSE `encodeUnknownSync` 不再对未知 tag 抛异常，SDK v2 已重生成）；executor 流增加单 defect 监督（不再整流停摆）。**2026-08-02 修订**：只读覆盖清理从 requester 移至 executor（`settle` 后 `clearOverride` 经 child location 作用域 `SessionToolPermissions.delete`），修掉「后台 publish 即删覆盖→子代理无只读默认」与「前台超时删覆盖→孤儿提权」竞态；`wait` 超时补 `sessions.interrupt(child)` 杀孤儿。fork 现有 `subagent/` 手搓 loop 的 fork/resume 模式 **已删除**（`delegate_task` 从不传 `mode/resumeSessionID`，那 ~165 行 resume branch + `as any` 堆 + 第二条手搓 model loop 为死代码，`SubagentResult` 联合类型恢复，`run` 改 `Effect.scoped` 内部 fork）。测试 `packages/core/test/subagent-runner.test.ts`（端到端：父会话→子代理 durable 运行→返回文本）。**上游正以插件形态（`SubagentTool.Plugin` + `PluginRuntime`）做子代理入 V2，本实现为 fork 自有路线，上游该能力稳定合入后对抗审计收敛** |
| `packages/core/src/tool/mcp.ts` + `packages/opencode/src/mcp/v2.ts` + instance server (v2 MCP 工具注册) | 中 | 保留（**fork 抢先，上游 dev 尚无 V2 MCP**）：依赖反转——core 定义 `MCP.Service` 接口（`tools()`/`call()`，core 不碰 MCP 协议）+ 空默认全局节点 + `MCP.toolNode`（location 作用域，经 `MCPClient` 取工具、转 `Tool.AnyTool`、`Tools.Service.register` 注册，注册错误 `orDie` 避免污染 location图错误类型）；opencode `mcp/v2.ts` 包裹现有 V1 `MCP.Service` 提供真实实现，经 `buildLocationServiceMap([[MCP.node, MCPV2.node]])` 替换空节点。第一版 input 用通用 object schema（保留各 MCP 工具 JSON schema 给模型是后续）。测试 `packages/core/test/tool-mcp.test.ts`（MCP 工具注册进 V2 ToolRegistry）。上游提供 V2 MCP 后对抗审计收敛 |
| `packages/core/src/session.ts` (v2 `SessionV2.create` parentID/title/location 继承) | 低 | 保留：逐字移植上游 in-flight 提交 `5e90a68d6a`（wip(core): v2 subagent foundations）的 create 切片。`CreateInput` 增 `parentID`/`title`、`location` 改为可选（缺省且给定 parentID 时子会话继承父会话 location），`create` 内解析父 location 并写入 `parentID`/`title`、`SessionV1.Event.Created` 改用解析后的 location。是 v2 子代理持久化管线的前置基础（awaitIdle/wait 切片已在本清单前条登记）。`packages/core/test/session-create.test.ts` 全绿（上游该分支合入后按上游版本对齐）。**注**：`5e90a68d6a` 的 subagent 工具为 node 接线（location 作用域工具依赖全局 `SessionV2`→未绑定 `SessionExecution`），上游后续已放弃该接线、改为经 `PluginInternal` 注册的插件形态（`1ea9137c01`）；故本条仅移植 create 基础，subagent 工具本体待按上游插件形态适配移植 |
| `packages/core/src/session/runner/llm.ts` + `session/{schema,projector}.ts` + `packages/opencode/src/session/session.ts` (v2 runner 三.1 审计切片：重复 tool 调用限界 + 标题生成 + Step usage 累计) | 中 | 保留（fork 自有改进，对应 `llm.ts` 顶部 spec 清单勾选项）：① 重复相同 tool 调用限界——drain 级 `repeatedTracker`（`MAX_REPEATED_TOOL_CALLS=2`，参数经 `canonicalizeInput` 按键排序归一），第 3 次连续同 tool 同入参调用不发执行、直接发布 error `toolResult`（`state.status: "error"`，模型可见纠正信息后继续）；② `ensureTitle`——drain 结束后在有默认标题 + 无 parent + 恰一条 user 消息时，以 `cache: "none"` + `maxTokens: 40` 的小请求生成标题并落库（失败静默，不失败 drain；`isDefaultTitle` 正则从 opencode 上移到 core `SessionSchema` 共用）；③ projector：`Step.Ended` 把 cost/tokens 累计进 SessionTable 列（`cost`/`tokens_*`）并刷新 `time_updated`、`Step.Failed` 仅刷新 `time_updated`，replayable 消费者可读 drain 级汇总。测试 `packages/core/test/session-runner.test.ts`（blocks the third consecutive identical tool call / derives a title from the first user message / does not derive a title for sessions with an explicit or parent title）+ `session-projector.test.ts`（accumulates step usage and touch time on the Session row）（上游 runner 若补同等实现则取上游版本并还原测试） |
| `packages/core/src/tool/bash.ts` + `permission/arity.ts` (三.2 审计切片：BashArity 前缀审批 + 二进制输出 + 进程组验证) | 中 | 保留（fork 自有改进）：① **BashArity 前缀审批**——从 V1 `packages/opencode/src/permission/arity.ts` 移植纯函数 `BashArity.prefix`（ARITY 字典 + longest-prefix 匹配）到 core，`bash` 工具 `permission.assert` 的 `save` 由整条命令改为**命令段级**（`commandSegments` 按 `;`/`|`/`&` token 切分，引号感知）的 BashArity 前缀 + ` *` 通配模式（如 `git commit -m "x"` → `git commit *`），配合 `PermissionV2` wildcard 匹配使同类命令可复用「always」审批；② **二进制输出**——`isUtf8`（`TextDecoder` fatal 模式）检测非 UTF-8 捕获，输出 `(binary output: N bytes not shown as text)` 替代静默解码乱码；③ **输出落盘**——`:77` TODO 关闭：`ToolRegistry.settle` 已对每个工具 settlement 通用调用 `ToolOutputStore.bound`（有界预览 + 托管文件 + 7 天保留），bash 层只保留 `MAX_CAPTURE_BYTES` 捕获上限；④ **进程组清理验证**——`cross-spawn-spawner` 已有 detached + killGroup 语义，补 `process.test.ts`（timeout kills the detached process group including grandchildren）验证孙进程随组被杀。`tool-bash.test.ts` 锁定 TODO 列表同步移除已解决 3 条、新增 arity save 模式 + binary 测试；新增 `permission-arity.test.ts`。剩余 TODO（tree-sitter parser、外部目录 parser 检测、Windows 路径、插件 shell.env、progress 流、后台任务持久化）维持锁定（上游若实现同等功能则取上游版本） |
| `packages/core/src/tool/{edit,write}.ts` (三.3 审计切片：Edit/Write 发布 `file.edited` 事件) | 中 | 保留（fork 自有改进）：V2 watcher 已自动把文件系统变更发布为 `FileSystemWatcher.Event.Updated`（`filesystem/watcher.ts` 订阅回调），但「工具编辑」语义事件 `FileSystem.Event.Edited`（`file.edited`，manifest 已含）全仓库无发布方。本次接线：edit/write 成功写入后发布 `{ file: target.canonical }`（绝对路径，对齐 V1 语义），`EditTool.node`/`WriteTool.node` 增 `EventV2.node` 依赖；锁定 TODO 列表同步移除「Publish watcher/file-edit events after V2 watcher integration exists.」并留说明注释（`Updated` 由 watcher 承担，工具只发 `Edited` 避免双发）。测试 `tool-edit.test.ts`/`tool-write.test.ts`（publishes a file.edited event for the canonical target after a successful edit/write）。**未接线**：formatter（V2 Format runtime 不存在）、LSP 诊断（V2 LSP runtime 不存在）、快照/undo（设计未定）、fuzzy 匹配策略——维持锁定 TODO；`apply_patch` 未在审计范围内，保持现状（上游若实现同等事件则取上游版本） |
| `packages/core/src/v1/config/config.ts` (`experimental.batch_tool` 声明无消费者) | 低 | 登记（**跟随上游，不做处理**）：上游 dev `config.ts:172` 同样声明 `batch_tool` 且全仓库（含 V1/V2）无消费者。删除会造成 sync 冲突，保持对齐；上游清理时跟随 |
| `packages/core/src/database/sqlite.{bun,node}.ts` (`executeStream()` 死 stub) | 低 | 登记（**跟随上游，不做处理**）：`executeStream` 是 effect `SqlConnection` 接口的必需成员（`effect/unstable/sql/SqlConnection`），两个 driver 以 `Stream.die("executeStream not implemented")` 满足接口，零调用。上游 dev 同样实现；bun:sqlite/node:sqlite 均可流式实现但无消费者，保持对齐（上游实现或接口变更时跟随） |
| `packages/codemode/src/openapi/` (~1100 行导出无人消费) | 低 | 登记（**跟随上游，不做处理**）：`packages/codemode/src/index.ts:3` `export * as OpenAPI from "./openapi/index.js"`（spec.ts 511 + types.ts 112 + index/runtime），code-mode.ts 工具只 import `CodeMode`/`Tool`/`toolError`，全仓库无 OpenAPI 消费者。上游 dev `git show upstream/dev:packages/codemode/src/index.ts` 完全一致（同三导出），保持对齐；上游清理时跟随 |
| `packages/tui/src/parsers-config.ts` (HTML injections 被注释) | 低 | 登记（**跟随上游，不做处理**）：`:153` TODO「Injections not working for some reason」——html parser 的 `injections` 查询与 `injectionMapping`（script_element→javascript / style_element→css）均被注释，因 opentui 库本身无 `injectionMapping` 类型/运行支持，注入不生效。上游 dev 同款注释；opentui 支持后按上游恢复 |
| `packages/opencode/src/permission/index.ts` (三.4 审计切片：`permission.ask` hook 接线) | 中 | 保留（fork 自有改进）：`permission.ask`（V1 Permission）在 hook 声明中带文档（`packages/plugin/src/index.ts:261`，input: SDK `Permission` = PermissionV1.Request，output `{status: "ask"|"deny"|"allow"}`），但 core 从不触发。本次在 V1 `Permission.ask` 的 `needsAsk` 分支、`Deferred` 创建前触发 `plugin.trigger("permission.ask", info, { status: "ask" })`：返回 `allow` 提前放行（跳过 pending/Event.Asked）；返回 `deny` 返回 `DeniedError`（ruleset 过滤同现有 deny 语义）；返回 `ask` 走原 pending 流程。`Permission.node` deps 增 `Plugin.node`（无环：session/processor.ts 已同依赖）。测试 `next.test.ts` 新增 hook 三分支（allow/deny/ask 各一）。**注意**：V2 core `PermissionV2.assert` 未接线（hook 输出为 V1 Request 形状），如需 V2 支持单独设计 |
| `packages/opencode/test/provider/gitlab-duo.test.ts` (整文件注释) | 低 | 登记（**跟随上游，不做处理**）：文件为 `export {}` + 全部测试注释（TODO: UNCOMMENT WHEN GITLAB SUPPORT IS COMPLETED），引用已不存在的 V1 测试 API（`withTestInstance`/`getLanguage`/`GitLabWorkflowLanguageModel`）。上游 dev 同款文件；GitLab 支持本身是活路径（`provider.ts:130` 动态导入 `gitlab-ai-provider` + `transform.ts` 两处 case），测试只是上游遗留。上游解除注释时跟随 |
| `packages/core/src/config.ts:75` (`lsp` 字段无读取者) | 低 | 登记（**跟随上游，不做处理**）：V2 `Config.Info.lsp` 仅被 V1→V2 迁移写入（`v1/config/migrate.ts:50`），V2 无读取者（V2 LSP runtime 不存在，edit/write 锁定 TODO 已记）；实际 LSP 功能仍走 V1 路径（opencode httpapi `instance.lsp`、cli debug lsp、experimentalLspTool flag）。上游 dev 同款声明（config.ts:19 导入 + :75 字段）；V2 LSP runtime 落地时按上游跟随 |
| `packages/llm/src/llm.ts` (`LLM.generateObject` 仅测试使用) + `packages/llm/src/providers/{xai,github-copilot,cloudflare}.ts` (facade 仅 llm 包测试可达) | 低 | 登记（**跟随上游，不做处理**）：`LLM.generateObject` 是 llm 包顶层命名空间公共 API（AGENTS.md 列明的 5 个 request-shaped API 之一，强制 tool call 实现跨协议统一 JSON 输出），实现完整 + `generate-object.test.ts` 5 用例（成功/schema 解码失败/模型不调 tool）全覆盖；产品侧 opencode 目前用 AI SDK `generateObject`（`agent.ts:432`），native runtime 扩展时接入。provider facades 是库公共 API 面：`native-request.ts` 已接线 7 家（Bedrock/Anthropic/Azure/Google/OpenAI/OpenAICompatible/OpenRouter），XAI/Copilot/Cloudflare 留待需要时接入（opencode 产品 provider 对这三家走 `@ai-sdk/*`，`provider.ts:119`）；recorded tests 正是库 API 的正确验证形态。上游 dev 完全同款（`providers/index.ts` 同 11 导出、`llm.ts` 同 generateObject） |
| `packages/opencode/src/control-plane/{workspace.ts,types.ts,workspace-adapter-runtime.ts}` + `server/routes/instance/httpapi/middleware/workspace-routing.ts` + 关联测试 (workspace 远程同步移除) | 中 | **2026-08-02 fork 新删**：移除 workspace **远程同步**模式。fork 早前已裁 server 端 `/sync/*` 路由（行 122/137 清单），但客户端 `workspace.ts` 仍调 `/sync/history|replay|steal` + `/global/event` SSE（唯一内置 worktree adapter 恒 `local`，故生产不可达但 404 死线）。本轮删除：`Target` 的 `remote` 变体（local-only）、`connectSSE`/`parseSSE`/`syncHistory`/`syncWorkspaceLoop`、`runInWorkspace`/`sessionWarp`/`startSync` 的 remote 分支、`syncFibers`/`stopSync`、workspace-routing 的 `RemoteTarget`/`proxyRemote` 分支、8 个 remote 测试。**保留**：本地 worktree 功能、`status`/`connections`、`isSyncing`（恒 false）、`waitForSync`/`synced`/`waitUntilSynced`（本地 DB seq fence 仍有意义，`fence.ts`/`x-opencode-sync` 头不变）。净删 ~1624 行。上游若恢复 workspace 远程同步则取上游版本对抗审计 |

### 安全与健壮性修复轮（本轮清单 C2/C3/H1-H8/M1/M3）

| 条目 | 优先级 | 处理 |
|---|---|---|
| `/provider` + `/config/providers` 响应 `key` 外泄 | 高 | **已修**：`Provider.toPublicInfo` 增 `redactKey` 选项，两个 handler 置 `key: undefined`（`Info.key` optional，序列化即删除）；`models` 的 catalog 路径无 `key` 无需处理。httpapi-exercise 全绿（210 场景） |
| operationId `v2.session.messages` 双端点冲突（`/api/session/{sessionID}/message` 与 `/messages` 共用同一 operationId） | 高 | **已修**：`packages/protocol/src/groups/message.ts` 单数端点 operationId 改为 `v2.session.message.list`（响应 identifier `SessionMessageListResponse`），SDK v2 重新生成（`sdk.gen.ts` `Message.list`），httpapi-exercise 引用同步更新 |
| V2 runner 未读 `SessionToolPermissions`（子代理只读默认在 durable 管线失效） | 高 | **已修**：`session/runner/llm.ts` 在 `tools.materialize` 前先查 `SessionToolPermissions.get(sessionID)`、缺省回退 `agent.info.permissions`；`SessionToolPermissions.node` 加入 runner deps（子代理 runner 已 set，此前无消费方） |
| CONTEXT.md:194 不变式：`settleWith` 对 `StorageError` 兑底 | 高 | **已修**：`ToolOutputStore.bound` 写失败降级为「无路径的有损有界输出」（marker 改「could not be retained」，`outputPaths: []` + warning log）；`ToolRegistry.settleWith` 对残留 StorageError（encode）同样降级。测试 `tool-output-store.test.ts`/`session-runner-tool-registry.test.ts` 同步改期望（不再 Exit failure） |
| 假 `spawn_agent` 工具链 + subagent fork 遗留块 | 高 | **已修**：删除 `spawn-agent.ts`/`spawner.ts`/`worker.ts`/`depth.ts`/`registry.ts`（worker 是 stub、唯一消费方是假工具）与 `runner.ts` fork-mode 遗留块；`builtins.ts`/`location-layer.test.ts` 移除引用；路径入 merge-clean `removedOpencodePaths`。spawner 管道死锁（exited 先于 drain）随文件删除消解 |
| V1 shell timeout 无上限 + V1 websearch 无界响应 | 中 | **已修**：V1 shell 增 `MAX_TIMEOUT_MS=10min` 上限校验（对齐 V2 core bash）；V1 `mcp-websearch.ts` 用 `collectBoundedResponseBody`（256KiB 上限，对齐 V2 core websearch）替代无界 `response.text` |
| V1 apply_patch 无 CAS + V1/V2 patch 双实现 | 中 | **已修**：V1 apply_patch update/move 记录 `originalBytes`，写入前重读比对，变更则失败（`changed on disk after it was read`）；补测试（ask hook 中改文件验证拒绝）。V1/V2 patch 双实现为双运行时刻意分治（V1 模块上游所有、V2 core 为 fork 新建），保持一致 CAS 语义；V1 patch 模块未改动（上游跟随） |
| TUI `data.tsx` SSE 优雅关闭冻结 | 中 | **已修**：会话级事件订阅 `for await` 改为 `Promise.race(next(), abortPromise)`，`onCleanup` 触发 abort 时立即 `iterator.return()` 退出（原实现 idle 连接下 abort 不唤醒 iterator 导致 cleanup 挂起） |
| llm `Stream.catchCause` 吞中断 | 中 | **已修**：`route/client.ts` `streamPrepared` 的 catchCause 先判 `Cause.hasInterruptsOnly(cause)` 则 `Stream.failCause(cause)` 透传，否则才转 streamError。补测试（interrupt 保持中断语义） |
| 实例路由密码比较非 timing-safe | 中 | **已修**：`packages/opencode/src/server/auth.ts` `authorized` 改 `crypto.timingSafeEqual` + 长度前置（对齐 `packages/server/src/auth.ts`）；auth 测试全绿 |
| 事件面 Latest/ServerDefinitions | 低 | 登记（架构性正确）：opencode 实例面用 `Latest`（90 全事件，服务 TUI/legacy），standalone server 用 `ServerDefinitions`（60 当前事件，服务 SDK）；manifest 测试锁定计数。无改动 |
| 消息游标入 Protocol + `/messages` 默认 limit | 低 | **已修**：`MessageGroup` 响应含 `cursor`（Protocol 已含）；`packages/server/src/handlers/{session,message}.ts` 两处 `/message(s)` 查询 `ctx.query.limit ?? DefaultMessagesLimit(50)` |

### 安全与加固修复轮（2026-08-02 第二批，审计遗留清理）

| 条目 | 优先级 | 处理 |
|---|---|---|
| UI 回退代理转发 `authorization`/`cookie` 到 `app.opencode.ai`（`OPENCODE_SERVER_PASSWORD` 外泄） | 高 | **已修**：`ProxyUtil.headers` 增 `stripCredentials` 选项，`serveUIEffect` 的 UI 回退代理启用之（剥离 Basic auth 密码与会话 cookie，不外泄给第三方上游）；通用 `middleware/proxy.ts`（用户配置的 MCP/workspace 目标）保持转发 auth 不动（上游若已做可取上游版本） |
| `amazon-bedrock` 把 API key 写入 `process.env.AWS_BEARER_TOKEN_BEDROCK`（泄漏给 bash 子进程 + `/proc/<pid>/environ`，跨 switch 残留旧 key） | 高 | **已修**：token 改经 SDK factory `apiKey` option 传入（`@ai-sdk/amazon-bedrock` 支持 `apiKey`，已核对 SDK 源码），不再改 `process.env`；保留「显式 env 优先」语义。**sap-ai-core 未改**：`@sap-ai-sdk` 动态安装、仅读 `AICORE_SERVICE_KEY` env 且 factory 无 apiKey option，改动会破坏认证——维持 env 注入并注释说明（上游若支持 option 则取上游版本） |
| `waitForPromotion` 对缺失 job 返回 `Effect.never`（task 工具 race 挂死） | 中 | **已修**：`background-job.ts` 缺失/未知 id 返回 `undefined`（幂等 no-op），不再 wedge `task.ts` 的 `raceFirst`（上游若已做可取上游版本） |
| `ToolOutputStore.cleanup` 对 stat 失败/mtime 缺失的条目当「远古」删除 | 中 | **已修**：stat 失败或无 mtime 的 `tool_*` 条目跳过（不再把「无年龄信号」当「可删」）；`info?.mtime.pipe(...)` 在 `info` 为 undefined 时还会抛 TypeError，一并修复（上游若已做可取上游版本） |
| node sqlite 语句缓存 FIFO 驱逐（非 LRU，热查询可能被挤掉） | 低 | **已修**：`getStatement` 命中时重插 Map 使迭代序反映最近使用，驱逐最久未用而非最旧插入（上游若已做可取上游版本） |
| `catalog.available()` 无 key/无连接的裸 `true` 兜底 | 低 | 登记（**不做处理**）：`provider.integrationID === undefined && !integration` 对 header-auth/keyless 本地 provider 是合法信号（如 Google 原生 `x-goog-api-key`、本地 server），收紧会误伤；MERGE 行 164 已修 fork 关心的 `api.settings.apiKey` 分支。上游若提供明确判定再对抗审计 |

### 依赖卫生（四批审计 37-45）

| 条目 | 优先级 | 处理 |
|---|---|---|
| 12 个零引用依赖（@opentelemetry/{api,context-async-hooks,exporter-trace-otlp-http,sdk-trace-base,sdk-trace-node}、@zip.js/zip.js、@solid-primitives/{event-bus,scheduled}、@pierre/diffs、partial-json、@standard-schema/spec、@ai-sdk/provider-utils） | 低 | 登记（**跟随上游，不做处理**）：全仓库源码（packages/*/src）零 import；`@ai-sdk/provider-utils` 在 core `dependencies` 声明（非仅 patch，审计描述需修正）。上游 dev 同款声明（opencode 5×otel + zip/solid/pierre/partial-json/standard-schema 逐一核对一致；core 同款 otel×4 + provider-utils）。删除会造成 sync 冲突且锁文件已含解析；上游清理时跟随 |
| 错位依赖 glob/mime-types/xdg-basedir | 低 | 登记（**跟随上游，不做处理**）：声明在 opencode + core（非仅 opencode，审计描述需修正），源码只在 `core/src`（util/glob.ts 等）使用。上游 dev 同款双声明；npm 提升后单一安装，无体积问题。上游清理时跟随 |
| 7 个 stale patch（@dnd-kit/dom、@tanstack/virtual-core、@pierre/trees、@standard-community/standard-openapi、gcp-metadata、pacote、@ff-labs/fff-bun） | 低 | 登记（**跟随上游，不做处理**）：前 4 个锁文件已无对应包（死 patch）；gcp-metadata patch 8.1.2 vs 锁解析 8.1.4、pacote 21.5.0 vs 21.5.1、fff-bun 0.9.3 vs 0.9.4（patch 不生效）。上游 dev `patchedDependencies` 15 条与 fork 完全一致（含全部 7 个 stale）。删除后 sync 时上游 patch 块会冲突；上游清理时跟随 |
| 17 个死 catalog 条目（@octokit/rest、@hono/standard-validator、@hono/zod-validator、@tanstack/solid-virtual、@shikijs/stream、@types/luxon、hono、hono-openapi、luxon、marked、marked-shiki、remend、shiki、solid-list、vite、solid-sonner、vite-plugin-solid） | 低 | 登记（**跟随上游，不做处理**）：全部为已删包（TUI 老栈/enterprise/桌面）遗留；上游 dev catalog 62 条目与 fork 完全一致（含全部 17 个死条目）。**注**：`@octokit/rest` 是 merge-clean 脚本 banned 依赖（见 merge-clean.ts），不可恢复使用。上游清理时跟随 |
| minimatch 双版本（opencode 10.0.3 vs core 10.2.5） | 低 | 登记（**跟随上游，不做处理**）：锁文件 `minimatch@10.2.5`（core 用，`core/src/util/glob.ts`）+ `opencode/minimatch@10.0.3`（opencode 声明但源码零引用）。上游 dev 同款双声明。删除 opencode 声明即消双安装，但会造成 sync 冲突；上游清理时跟随 |
| 重复代码：isDefaultTitle / webSearchProviderLabel / GPT-5 reasoning policy | 低 | 登记（**跟随上游，不做处理**）：① `isDefaultTitle`——opencode 已收敛为 core `SessionV2.isDefaultTitle` 单一来源（三.1 登记），tui `util/session.ts` 独立同义正则版为上游遗留（上游 tui 同款）；② `webSearchProviderLabel`——opencode `tool/websearch.ts` 与 tui `util/tool-display.ts` 逐字节相同（diff 验证 IDENTICAL），上游两处同款；③ GPT-5 reasoning policy——llm `providers/openai-options.ts` `gpt5DefaultOptions`（native 路径）+ opencode `provider/transform.ts:1311`（AI SDK 路径），双运行时架构性双维护（`native-runtime.ts:85` 注释明确 both sides intentionally use），上游两处同款 |
| 重复代码：MCP `sanitize`/`toolName`（core `mcp/registration.ts` 复制上游 opencode `mcp/catalog.ts` 逐字节同款单行） | 低 | 登记（fork 自有，刻意保留）：fork 新建的 V2 core MCP 注册文件（三.4 登记，上游 dev 尚无 V2 MCP）内联 `sanitize`/`toolName` 单行（`[^a-zA-Z0-9_-]`→`_`），与上游 V1 opencode `mcp/catalog.ts` 逐字节相同。与 arity 同为 V1/V2 跨运行时刻意双维护模式；core 不依赖 opencode 包、两运行时各自存活。上游提供 V2 MCP 后随三.4 一起对抗审计收敛 |
| AGENTS.md 生成命令过时（packages/client 已删） | 低 | **已修**（fork 特有修正）：原「run `bun run generate` from `packages/client`」因 fork 删除 packages/client（已删包列表）失效。改为实际命令：「regenerate the OpenAPI spec with `bun dev generate` from `packages/opencode`」（CLI `generate` 命令 `packages/opencode/src/cli/cmd/generate.ts`，SDK 构建经 `packages/sdk/js/script/build.ts` 消费）。上游有自己的 packages/client，此条只影响 fork |
| 本地残留：packages/cli/dist（12 平台 lildax 二进制 1.3G）+ natives/target（cargo 产物 229M） | 低 | **已清理**：`packages/cli/`（已删包列表成员，残留 dist + node_modules）与 `natives/`（cargo 产物）整目录删除；均未跟踪、gitignore 覆盖，git status 干净 |
| 死 sst-env 类型垫片（12 个 `packages/*/sst-env.d.ts`） | 低 | **已清理**：各包 `sst-env.d.ts` 引用根目录 `sst-env.d.ts`（fork 无）且 `sst` 非依赖、tsconfig 未 include、零引用。已删除并列入 `script/merge-clean.ts` `removedOpencodePaths`（上游若恢复随 sync 自动重删） |
| 已删包空壳目录残留（app/client/console/desktop/effect-sqlite-node/enterprise/function/httpapi-codegen/script/sdk-next/session-ui/slack/stats/storybook/ui/web） | 低 | **已清理**：git 未跟踪、gitignore 覆盖的 `.turbo`/`node_modules`/残留子目录整删，`packages/` 恢复为 12 个功能包 |
| 40 个 TUI 音效 mp3（`packages/tui/src/assets/audio/` 删 40 留 5） | 低 | **已登记**：删 40 个未被引用的 mp3，保留 5 个被引用（bip-bop-01/03、staplebops-06、nope-03、yup-01）；路径已入 `script/merge-clean.ts` `removedOpencodePaths`（上游若把音频迁回 `packages/tui` 随 sync 自动重删） |

### TUI 偏离（四批 23 轮审计打磨，全域）

`packages/tui/**` 经四批审计后与上游存在**面状偏离**（约 80+ 文件）：类型安全、floating promise 治理、死代码删除、主题色彩统一（`selectedForeground` helper）、间距/文案规范、空态/加载态语义化、动画开关（`animations_enabled`）全覆盖等。

**总体处理方式**：TUI 冲突一律走第 ④ 类对抗审计。fork 的修复多为一致性与状态完整性改进；上游若有同等或更完整实现（尤其上游修复了同类问题时）优先取上游，减少偏离面。以下为仍需单点关注的条目：

| 冲突来源 | 频率 | 处理方式 |
|---------|------|---------|
| `packages/tui/src/component/error-component.tsx` (issue URL) | 低 | 保留 `https://github.com/3kaiu/opencode-x/issues/new`（上游指向 anomalyco/opencode，永久偏离） |
| `packages/tui/src/theme/index.ts` (overlay 颜色变量 + selectedForeground + 代码块面板) | 中 | 保留 `overlay`/`overlayLight` 变量与 `selectedForeground(theme)` helper；`getSyntaxRules` 引用 `markdownCodeBlock` 做代码块底色 + 标题分级 + 行内 chip；`resolveTheme` 增 `markdownCodeBlock` 背景兜底 + `backgroundBackdrop` 改可选（对齐 plugin `TuiThemeCurrent`）（上游若已做可取上游版本） |
| `packages/tui/src/ui/dialog.tsx` (响应式布局 + overlay) | 低 | 保留 `Math.max(1, ...)` 顶部间距、`Math.max(40, ...)` 最大宽度、`theme.overlay`（上游若已做可取上游版本） |
| `packages/tui/src/ui/dialog-select.tsx` (当前项标记颜色 + emptyView) | 低 | 保留 `theme.primary` 当前项标记、`emptyView` 自定义空态入口（上游若已做可取上游版本） |
| `packages/tui/src/ui/dialog-help.tsx` (快捷键分类) | 低 | 保留按类别分组的快捷键显示（上游若已做可取上游版本） |
| `packages/tui/src/component/dialog-session-list.tsx` (空状态 + 删除确认) | 低 | 保留 contextual 空态消息、删除确认 `✗` 前缀（上游若已做可取上游版本） |
| `packages/tui/src/component/command-palette.tsx` (命令面板空状态) | 低 | 保留 contextual 空态消息（上游若已做可取上游版本） |
| `packages/tui/src/routes/session/index.tsx` (revert 边框 + ThinkingScanner + 代码块分段/流式防闪/reasoning markdown/Skill/summary + 会话加载态) | 中 | 保留 revert banner 边框、Thinking 复用 `ThinkingScanner`；`TextPart` 流式走单 `<markdown streaming>`、完成后切 `<For>`+`CodeBlock` 面板（防逐 token 重建闪烁）；`ReasoningPart` 用 `subtleSyntax()` markdown；`Skill(name)` 括号约定；summary 行 `GLYPH.dot`；`<Show when={session()}>` 增 fallback：`sync.ready` 前显 `Spinner`（Loading session）、就绪仍缺则 `Session not found`（补齐初始 sync 期空白屏）（上游若已做可取上游版本） |
| `packages/tui/src/routes/session/permission.tsx` (权限图标匹配) | 中 | 保留权限图标与工具图标一致（上游若已做可取上游版本） |
| `packages/tui/src/routes/session/subagent-footer.tsx` (agent 色带 + 状态点 + agent-color 标签) | 中 | 保留 agent 专属颜色边框、状态点图标、紧凑索引、导航按钮样式；`SubagentFooter` 标签用 `local.agent.color` 上色（与 `Task` 运行态 bullet 一致）（上游若已做可取上游版本） |
| `packages/tui/src/component/message/primitives.tsx` (新增：Bullet/ResultBlock/CollapsedHint) | 中 | fork 新增共享消息原语；`Bullet` spinner 用 `ColorGenerator` 基色↔accent 呼吸渐变（受 `animations_enabled` 约束）；若上游引入同类原语对抗审计 |
| `packages/tui/src/component/prompt/creating-dots.ts` (新增：useCreatingDots hook) | 低 | fork 新增，抽出 `workspace.tsx`/`move.tsx` 重复的省略号动画为共享 hook，并用 `animations_enabled` 门控（关闭时固定 3 点，补齐上游遗漏的动画开关覆盖）；若上游收敛同类逻辑对抗审计 |
| `packages/tui/src/ui/glyphs.ts` (新增：GLYPH 常量含 mcp 状态字符组 + info/warning) | 中 | fork 新增，统一 footer/dialog-status/dialog-mcp 的 MCP/状态字符（`GLYPH.mcp.{connected,failed,disabled,loading}`、`GLYPH.dot` 等）+ `GLYPH.info`/`GLYPH.warning`（供 toast 变体图标引用）；若上游引入同类常量对抗审计 |
| `packages/tui/src/ui/toast.tsx` (变体图标引用 GLYPH) | 低 | 保留 `VARIANT_ICON` 改引 `GLYPH.{check,info,warning,cross}`（收敛到单一字符来源）（上游若已做可取上游版本） |
| `packages/tui/src/component/{dialog-mcp,dialog-status}.tsx` + `feature-plugins/home/footer.tsx` (MCP 状态字符统一) | 低 | 保留改用 `GLYPH.mcp` 取代散落的 `✗●○/•/⋯✓○`（上游若已做可取上游版本） |
| `packages/tui/src/component/{dialog-provider,dialog-debug,startup-loading}.tsx` + `feature-plugins/system/diff-viewer-file-tree.tsx` + `routes/session/question.tsx` + `ui/icon.tsx` (状态字符引用 GLYPH) | 低 | 保留散落的 `✓`→`GLYPH.check`、`⋯`→`GLYPH.idleSpinner`（字符完全一致、零视觉变化，收敛到单一来源便于统一改字宽）；`●` 状态点语义分歧暂未收敛（上游若已做可取上游版本） |
| `packages/tui/src/{audio,attention}.ts` (错误日志级别) | 低 | 保留 `console.error` 替代 `console.debug`（上游若已做可取上游版本） |
| `packages/tui/src/util/markdown.ts` + `test/markdown-polish.test.ts` (LLM markdown 打磨 + splitProseAndCode) | 低 | fork 新增（LaTeX→Unicode、CJK 强调符修复、`splitProseAndCode` 分段供代码块面板化），保留；若上游引入同类能力对抗审计 |
| 逐文件打磨轮1：`ui/{spinner,dialog-select,dialog-prompt,dialog-export-options,link,icon,glyphs}.ts(x)` + `{app,app-commands,clipboard,editor,logo,audio}.ts(x)` + `util/{collapse-tool-output,filetype,presentation}.ts` + `config/keybind.ts` | 中 | 保留 bug 修复：spinner 共享 RGBA 常量原地突变改克隆；dialog-select `selectedForeground` 惰值改响应式 + setTimeout 补 onCleanup；collapse-tool-output 负 hiddenCount 防护；app-commands KV 快照改响应式读 + heap snapshot undefined 提示 + isVersionGreater 多连字符预发布；clipboard GNU screen 用平 DCS 透传；editor $EDITOR 引号感知拆分；filetype 支持无扩展名/复合后缀；presentation 复用 logo.ts + 缺 sessionID 略去 Continue 行；删除死代码（icon.tsx 未用组件/映射表、glyphs 死导出、logo.marks、audio.stopVoice、Keybinds 壳、死 onCancel prop、app.tsx console.log）（上游若已做可取上游版本） |
| 逐文件打磨轮2：`component/{dialog-workspace-create,dialog-console-org,dialog-mcp,dialog-retry-action,dialog-session-rename,dialog-workspace-unavailable,dialog-status,spinner,bg-pulse-render,error-component,todo-item,workspace-label}.ts(x)` | 中 | 保留 bug 修复：dialog-workspace-create 最近工作区按连接状态过滤 + 空 adapters 用 `<Show>` 包裹；dialog-console-org 切换失败弹 error toast；dialog-session-rename 重命名失败弹 error toast；dialog-workspace-unavailable 恢复成功后关闭对话框；dialog-retry-action `selectedForeground` 惰值改响应式；error-component 复制失败重置 Copied 态 + ✖ 改 `GLYPH.cross`；todo-item icon/color/attrs 改派生函数（响应式）；删除死代码（dialog-mcp 未用 setRef、dialog-status 空 Props 类型、spinner SPINNER_FRAMES 别名、workspace-label 未用组件、bg-pulse-render 死导出与未用 cache:false 分支）（上游若已做可取上游版本） |
| 逐文件打磨轮3：`component/prompt/{autocomplete,index,move,workspace}.tsx` + 删除 `component/prompt/creating-dots.ts`、`component/workspace-label.tsx` | 中 | 保留 bug 修复：autocomplete `<Index>` 行内 8 个 setup 期常量改派生函数（行复用时 label/图标/颜色冻结）+ files resource 源补 `store.visible`（弹窗打开且查询未变时不刷新）；index shell/斜杠命令失败补 error toast（原静默丢输入）+ extmark 样式 ID 改访问器（主题切换后指向已销毁 SyntaxStyle）+ interrupt 双击计数器补 clearTimeout/onCleanup（陈旧定时器清零新计数）+ 内联 reduce 换用 `expandPastedTextPlaceholders` + `basename ?? "image"` 改 `\|\|`；workspace 死 notice 改为成功 warp 弹 success toast（原 showNotice 从未渲染）；删除死代码（Autocomplete sessionID prop、AutocompleteOption.disabled、move creatingDots/pendingNew、workspace label memo、creating-dots.ts 与 workspace-label.tsx 整文件）（上游若已做可取上游版本） |
| 逐文件打磨轮4：`context/{sync,sdk,project,local,theme,route}.tsx` | 高/中 | 保留 bug 修复：sync `message.removed`/`message.part.removed` 补 `if (!messages/!parts) break`（未加载会话/被驱逐消息触发 `search(undefined)` 抛错杀死事件循环）+ `lsp.updated` 改无条件调用 debounce（默认无 workspace 时 LSP 状态不再刷新的回归）+ 会话列表排序改用与二分查找一致的码位比较（localeCompare 大小写次序不一致）；sdk `onCleanup` 移出 `await` 之后（owner 已失效导致订阅永不清理）+ SSE 重连循环连接/迭代包 try/catch 并在收到事件后重置退避（一次网络错误即永久断连）；project/local 事件订阅补 onCleanup；删除死代码（LocalTheme、RouteContext、SyncContext 解构、theme_mode 只写不读的持久化）（上游若已做可取上游版本） |
| 逐文件打磨轮5：`routes/session/{index,dialog-message}.tsx` | 中 | 保留 bug 修复：TextPart `tableOptions` 由 setup 期字面量改 `createMemo`（原 `theme.border` 快照在主题切换后冻结表格边框色）；`index.tsx` revert 分支与 `dialog-message.tsx` revert/copy/fork 四处 `sync.data.part[id].reduce` 补 `?? []`（消息 part 未加载时 `.reduce` 抛错）；moveChild 方向语义（`- direction`）疑似与命令名相反但属上游行为，择要跳过（上游若已做可取上游版本） |
| 逐文件打磨轮6：`feature-plugins/system/diff-viewer-ui.tsx`（`routes/session/{dialog-timeline,permission,dialog-fork-from-timeline,subagent-footer,question}.tsx`+`routes/home*.tsx`+`feature-plugins/{system/*,home/*}` 已审计） | 中 | 保留 bug 修复：`Panel` `borderProps.borderColor` 由 setup 期快照改 getter（`theme.border` 随对象展开保持响应式，原主题切换后 diff 查看器面板边框色冻结，`Separator` 已用 `() =>` 正确）；fork `.data!.id` 无守卫（与 `dialog-message.tsx` fork 同款上游模式）择要跳过；`diff-viewer-file-tree-utils.moveFileTreeSelectionToFile` 仅测试引用但恐留待键位，暂不删（上游若已做可取上游版本） |
| 逐文件打磨轮7：`component/dialog-model.tsx`（`dialog-{agent,move-session,theme-list,variant,session-delete-failed,session-list,skill,stash,workspace-file-changes,workspace-list}.tsx`+`command-palette.tsx` 已审计） | 中 | 保留 bug 修复：收藏/最近模型选项由可选的 `model.id` 改用可靠的映射键 `item.modelID`（`id?: string` 缺省时 `model.id.includes("-nano")` 抛错、选中项 modelID 变 undefined；并与 providerOptions 分支用键一致）；`dialog-theme-list` `theme.all()` setup 期快照（需订阅 `subscribeThemes` 才能修，`all()` 非响应式且启动后基本不变）择要跳过（上游若已做可取上游版本） |
| 逐文件打磨轮8：`prompt/{part.ts,frecency.tsx}` + `test/prompt/part.test.ts`（`prompt/{display,history,stash,traits}` + `component/prompt/{history,frecency,stash}` 再导出壳已审计） | 中 | 保留 bug 修复：`expandPastedTextPlaceholders` 的 `String.replace(needle, part.text)` 改函数替换 `() => part.text`（粘贴含 `$&`/`$'`/`$$`/`$n` 的文本经 open-editor/copy 路径被当替换模式解释而损坏，补回归测试）；`frecency` 剪枝 `setStore("data", obj)` 改 `reconcile(obj)`（Solid store 合并语义使被剪路径永不删除，会话内 map 无限增长、每次 update 全量重写 jsonl）（上游若已做可取上游版本） |
| 逐文件打磨轮9：`context/{kv,data}.tsx`（`context/{permission,prompt,clipboard,editor,path-format,thinking,directory,location}` 已审计） | 低 | 保留 bug 修复：`kv` 读取前先 `Bun.file(file).exists()`，缺文件返回 `{}`（首次启动 `kv.json` 不存在时不再打印误导性的 "Failed to read KV state"，保留真实读/解析错误日志）；`data` 事件驱动的 `catalog/reference/integration.updated` 三处 `void refresh()` 补 `.catch(console.error)`（`throwOnError` 下瞬时失败原为未处理 rejection，与初始加载 allSettled+console.error 一致）；`editor.ts` Zed 轮询代际/`enabled()` 非响应式属自我纠正边角，按审计建议暂缓（上游若已做可取上游版本） |
| 逐文件打磨轮12：`util/locale.ts` + `test/util/locale.test.ts`（`ui/{dialog,dialog-alert,dialog-confirm,dialog-help,border,activity-verbs}` + `util/{renderer,record,system,signal}` 及轮10 `plugin/*`+`builtins`、轮11 `util/{revert-diff,scroll,selection,transcript,tool-display,model,session,format,path,provider-origin}` 均审计为净） | 中 | 保留 bug 修复：`truncateLeft`/`truncateMiddle` 修 `slice(-0)` 边界（预算=1 或 keepEnd=0 时 `str.slice(-0)===str.slice(0)` 返回整串，`Math.max(1,…)` 钳制的窄终端下 dialog-select/dialog-move-session/workspace-file-changes 会渲染出比原串更长的 `…+整串` 撑爆行），补回归测试（上游若已做可取上游版本） |
| 死代码批（四批审计「一、确定死代码」，见 MERGE.md「死代码删除批次」小节） | 低 | 删除零引用孤儿文件/死导出，路径已入 `script/merge-clean.ts` `removedOpencodePaths`（merge 后自动重删），详见下方小节 |

### 其他

| 冲突来源 | 频率 | 处理方式 |
|---------|------|---------|
| TS 壳接口签名变化 | 低 | 同步更新 TS 壳 |
| 上游新增工具协议 | 中 | 按第 ③ 类用途审计后决定 |

## 死代码删除批次（四批审计「一、确定死代码」）

以下文件全仓库零引用（或仅死测试自引用），fork 已删除；路径已入 `script/merge-clean.ts` `removedOpencodePaths`，merge 后自动重删。上游若恢复这些文件，merge-clean 在 sync 收尾时清除。

- `opencode/src/effect/bootstrap-runtime.ts` — 云账号删除后被孤儿化，BootstrapLayer 无引用
- `opencode/src/util/repository.ts` + `test/util/repository.test.ts` — 仅自测试引用（parseGitHubRemote 连测试都不用）
- `opencode/src/storage/schema.ts` — 删除遗留的死 re-export barrel（3 行转发 core tables）
- `opencode/src/session/message.ts` — legacy v1 message schema，已被 `message-v2.ts` 取代
- `opencode/src/dream/trigger.ts` + 目录（fork 特有）— dream 记忆整理功能断连，永不调用
- `opencode/src/ide/index.ts` + 目录、`util/defer.ts`、`util/signal.ts`、`control-plane/dev/debug-workspace-plugin.ts` — 零引用
- `core/src/session/wire.ts`、`session/fork.ts`（fork 特有）— SessionWire/SessionFork 命名空间零引用（SDK 的 SessionFork 是 HTTP 端点，无关）
- `core/src/data-migration.sql.ts`、`public-event-manifest.ts`、`plugin/layer-map.example.ts` — 零引用
- `core/src/subagent/index.ts`（fork 特有）— 零引用 barrel（子文件 runner/spawner/registry 全活）
- `core/src/v2-schema.ts` — 仅 `test/shared-schema.test.ts` 引用；DateTimeUtcFromMillis 改经 `core/src/schema.ts` 校验（同一 schema re-export）
- `core/src/util/{array,binary,iife,path,retry}.ts` — 零引用；`iife.ts` 与 opencode 活版逐字节相同（重复）
- `core/src/memory/dream.ts`（fork 特有）— 只被 dream/trigger.ts 引用（同删）；`memory/store.ts` 仍被活的 `memory/context.ts` 使用（保留）
- `server/src/routes.ts` — createRoutes/createEmbeddedRoutes/webHandler 零引用，opencode 自己组装 server（本地同名函数）
- `tui/src/util/icon-pixel-data.ts` — 677 行像素网格机制，只剩 `IconName` 类型在用（已迁 `component/icon-renderable.tsx`）
- `tui/src/util/format.ts` + `test/util/format.test.ts` — `formatDuration` 仅测试引用
- `tui/src/util/locale.ts` — 删 `pluralize`（零引用，保留 truncate/relativeTime）
- `tui/src/design-tokens.ts` — 删 `MESSAGE_INDENT_BORDERED`（零引用）
- `tui/src/config/keybind.ts` — 删 `Descriptions`（:250，零引用；`CommandDescriptions` :415 保留，被 :461 用）
- `tui/src/assets/audio/` — 45 mp3 删 40 个，保留 5 个被引用：bip-bop-01/03、staplebops-06、nope-03、yup-01

**验证**：core 全量 1004 pass / 20 fail（baseline 一致，零回归）；shared-schema.test.ts 2 pass；opencode permission+session 460 pass（1 pre-existing fail：session.retry.delay）；opencode/core/llm/tui/server typecheck 全绿。TUI 测试失败经 stash 验证为 pre-existing（sync/hydration 层，与本批无关）。

## 已删包列表（合并时自动处理）

以下包在 opencode-x 中已删除，合并时会出现 `modify/delete` 冲突：
- `packages/app/`
- `packages/desktop/`
- `packages/session-ui/`
- `packages/slack/`
- `packages/enterprise/`
- `packages/web/`
- `packages/function/`
- `packages/console/`
- `packages/stats/`
- `packages/containers/`
- `packages/identity/`
- `packages/storybook/`
- `packages/httpapi-codegen/`
- `packages/docs/`
- `packages/ui/`
- `packages/cli/`
- `packages/client/`
- `packages/sdk-next/`
- `packages/native-bridge/`
- `packages/script/`

处理方式：`bun script/merge-clean.ts` 自动 `git rm` 保留删除（清单维护在脚本顶部，与本列表同步）。

## 保留包列表（fork 主动保留，需要手动合入冲突）

以下包在上游更新中，opencode-x 选择保留，合并时需处理冲突而非删除：
- `packages/http-recorder/` — VCR 测试录制回放工具
- `packages/effect-drizzle-sqlite/` — Drizzle + Effect SqlClient 适配器

## 合并后验证

按顺序执行，全部通过后才提交 sync commit：

```bash
# 1. 清单驱动清理（退出码非 0 则按报告手工处理后重跑）
bun script/merge-clean.ts

# 2. 重建锁文件（不手动合 bun.lock）
bun install

# 3. typecheck（从包目录，不直接跑 tsc）
bun run --cwd packages/core typecheck
bun run --cwd packages/opencode typecheck
bun run --cwd packages/llm typecheck
bun run --cwd packages/tui typecheck

# 4. TUI 测试（fork 偏离最密集的包）
cd packages/tui && bun test

# 5. 若 opencode instance HttpApi 有变更（如 share/unshare 端点）：重生成 legacy JS SDK
bun ./packages/sdk/js/script/build.ts

# 6. 快照受影响时（CLI 命令/选项变更）：删除 .snap 后重生成
cd packages/opencode && bun test test/cli/help
```

提交信息标注 baseline：`chore: sync upstream to <baseline>`。

## sync 收尾清单

每次 sync commit 前确认：

- [ ] 五类分诊全部处理完毕（无未裁决冲突）
- [ ] 对抗审计裁决已登记/更新到「fork 偏离清单」
- [ ] 上游已吸收的偏离条目已移除
- [ ] 新拒绝的路径已加入 `merge-clean.ts` 清单与「已删包列表」
- [ ] 合并后验证全部通过
- [ ] **已判断 PLAN.md / MERGE.md 是否需要更新**（基线版本/sync 轨迹、新阶段/新包/新自有改进、偏离清单回写、`merge-clean.ts` 清单同步）——需更新则回写；无需更新则在 sync commit 说明中记录「PLAN/MERGE 已复核，无需更新」
- [ ] **热点区优先对抗审计**：`ripgrep.ts`/`tool/grep.ts`（工具）、`bus.ts`+`event.ts`（事件）、`session/runner/*`+`session/execution/*`（runner）是上游高频重构区，且 fork 在这些区有加固/自有改进偏离；本轮 sync 若上游触及以上任一区，优先并排比对——上游做了同等加固/重构则取上游版本并移除对应偏离条目，降低偏离面
- [ ] commit message 标注 baseline 版本

## 模块深度审计轮登记（2026-08，本 fork 自有改进，非 sync 触发）

对全仓 12 包执行的深度对抗审计（正确性/安全/死代码/断线四维）修复，逐项登记供下次 sync 对抗审计复审：

### CRITICAL
- **subagent 事件入 manifest**：`session.next.subagent.requested/result` 加入 `SessionEvent.Definitions`（此前发布+订阅但不在清单 → SSE `encodeUnknownSync` 对未知 tag 抛异常杀流、SDK 类型缺失、插件订阅空流）。manifest 计数 99/69/42（含既有漂移）；SDK v2 重生成；`message-updater` 补两 no-op arm。
- **SubagentExecutor 生产接线**：见上条偏离清单更新。
- **协议 v2 pty.connect 实时输出丢弃**：`server/src/handlers/pty.ts` `onData` 回调丢弃 `Queue.offer` Effect，改用 `Queue.offerUnsafe`（同 opencode httpapi 语义）；`Queue.bounded` → `Queue.dropping(1024)` 使溢出断连可达（fork 有界队列防内存增长意图保留）。

### HIGH
- **bash 审批段切分**：`tool/bash.ts` tokenizer 引号感知 + 操作符（`;|&`）独立切分（`hi;rm` 不再藏在一段）；新增 EXECUTE_WRAPPERS 守卫（`bash -c`/`eval`/`python -c` 等不存宽泛 `bash *` 审批模式）。测试 `tool-bash.test.ts` 补 2 例。
- **grep/glob Location containment**：`tool/grep.ts`/`glob.ts` 改经 `LocationMutation.resolve`，越界绝对路径要求 `external_directory` 审批（managed tool-output 豁免）；glob 默认 limit 100。
- **tool-output 保留清扫接线**：`ToolOutputStore.cleanupNode` 加入 opencode 生产组合（此前从未接线，`tool_*` 文件无限累积）。
- **TUI 会话级 SSE 自毁订阅**：`tui/context/data.tsx` effect 读写同一信号导致自触发重跑杀掉刚建订阅；改 `createMemo` 按值推导 sessionID。
- **SessionV2.fork 一致性**：fork 改经 durable `create`（不再裸写 SessionTable），拷贝消息 seq 重排 1..n，`EventV2.advanceSequence` 推进聚合序列避免下个 durable 事件与拷贝 seq 冲突；移除 `as any`。测试补「durable 序列前移」不变式。
- **HTTP 500 / session.error 不再泄露 `Cause.pretty`**：opencode `middleware/error.ts`（未提交 diff 已 revert）+ `handlers/session.ts promptAsync` 改安全文案 + `ref` 关联日志。

### MED
- retry 30s 上限旁路修复（headers 存在时指数退避也受 30s cap）；`session.next.tool.progress` 接线 producer（runner 工具执行前发布 running 态）；`ide.installed` 死 schema 删除；`bus.ts allBounded` 溢出改为丢弃事件而非 `Queue.fail` 杀 SSE 流；ripgrep 超长 JSON 记录改为丢弃（对齐 find/glob）；search.ts 目录索引 O(n²)→惰性物化；`sqlite.node.ts` `setReturnArrays` finally 复位；`SUBAGENT_READONLY_RULES` 动作名 `web_search→websearch`/`web_fetch→webfetch`；`BackgroundJob.waitForPromotion` 与 job 完成竞速防挂死；`compact` 失败记日志（不再静默吞）；SubagentExecutor 流单 defect 监督；`ensureTitle` 改 detached fiber 不阻塞 drain；`handlers/tui.ts` 删 `session_share` 别名 + `openThemes` 改 `theme.switch`；SDK legacy `share/unshare` 死方法 + httpapi-exercise 死场景删除；TUI fork 失败 toast、`--continue` 不再用 dummy session、revert banner hooks 提取为组件、`fullSyncedSessions` 在 `server.instance.disposed` 时清空。

### LOW / 死代码
- 删除：`subagent/coordinator.ts`（整模块死）、`session/runner/llm.ts prepareNextTurn`（死）、`llm/schema/thinking-level.ts`（整模块死）、`plugin/v2/effect/{filesystem,location,npm,path}.ts`（4 死模块）、`ide-event.ts`（死 schema）、`util/encode.ts` base64/sampledChecksum、`shell.ts killTree`、`util/token.ts estimateContextTokens`、`context-levels.ts estimateRequestTokens`、`limiter.ts activeCount/sessionCount`、`memory/store.ts` 5 个 CRUD（仅 getIndex 存活）、opencode `session.ts setShare/Session.diff` 死 stub、`runtime-flags.ts experimentalReferences`（零消费）。
- 过期 TODO：`file-mutation.ts:202`（file-edit 事件已实现）、MERGE.md 两条过期声明（SessionToolPermissions 消费方、SubagentExecutor 接线）已回写。

### 审计判定不处理（记录理由）
- `webfetch.ts` URL 校验：`Effect.try` 的 catch 走失败通道，`file://` 会快速失败 —— 原审计误读，非缺陷。
- v1→v2 Synthetic 桥接幂等：双桥接已被 Prompted 确定性 messageID 阻断（重复发布会先触发 unique 冲突 defect），实际不可达。
- V2 `PermissionV2.assert` 插件 `permission.ask` 钩子：属 MERGE.md「Flagged ambiguities」标注需单独设计的特性缺口，非缺陷；不做。
- `awaitToolFibers` raceFirst：实测顺序化 `awaitEmpty+join` 会死锁 subagent 管线，且原 `join` 急切失败实际不会吞失败 —— 回退保留原实现。

### 已知遗留（本次未动）
- `sessions.events` durable replay 无界读（`bus.ts readAfter` `.all()` + `durable()` 整数组）—— `specs/v2/todo.md` 已登记分页待办，跨进程+恢复语义未定。
- 手动 compact 与进行中 drain 的串行化（MERGE.md 既有已知限制）。
- 背景子代理的 durable 恢复/认领（`specs/v2/todo.md` deferred）。
