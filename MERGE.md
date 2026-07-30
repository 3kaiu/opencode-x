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
| `packages/opencode/src/cli/cmd/run/stream.transport.ts` (MAX_BUFFERED cap + fail 内联错误) | 中 | 保留 `MAX_BUFFERED = 500` + `pushBuffered()` helper、`fail()` 中 `input.footer.append({ kind: "error" })` 内联错误显示（上游若已做可取上游版本） |
| `packages/core/src/ripgrep.ts` + `packages/core/src/tool/grep.ts` (执行超时 + 有界行框界 + grep 默认 limit) | 中 | 保留 `run()` 的 `DEFAULT_TIMEOUT = 30s`（`Effect.timeoutOrElse` 复用 `Ripgrep.Error`，超时关 scope 杀子进程）+ `Find/Glob/Grep` 可选 `timeout?` 覆盖；`splitBoundedLines(MAX_RECORD_BYTES)`（`Stream.mapAccum` 单行永不超 64KB 缓冲，grep 截断 JSON 记录沿用失败语义、find/glob 超长行跳过不失败）；`filesystem/search.ts` 后台全仓索引显式 `timeout: "10 minutes"`；grep 工具 `DEFAULT_LIMIT = 100`（替换 `Number.MAX_SAFE_INTEGER`）（上游若已做可取上游版本） |
| `packages/core/src/{event.ts => bus.ts}` (纯改名) | 低 | 纯改名：EventV2 实现整体从 `event.ts` 移入新文件 `bus.ts`（内容逐字节等价，仅头部自导出行移动），`event.ts` 收敛为转发桥接单行 `export * as EventV2 from "./bus"`；全部导入方经 `EventV2` 引用，改名对调用方透明。**未包含**任何行为改动：`durable()` historical 仍为整数组加载、`readAfter` 仍为无界 `.all()`、`pubsub.durable` 仍为 `Map<string, Set<PubSub>>`。durable-tail 分页 + `RcMap` wake 简化仍是待办（`specs/v2/todo.md`），尚未实现（上游若已做可取上游版本） |
| `packages/core/src/database/migration.ts` (跨进程 claiming 竞态闭合) | 中 | 保留把"是否已应用"判定移入每条 migration 的 immediate 写事务内（`applyOnly` 事务内 `SELECT id ... WHERE id = ?` 复核后再 `up`；bootstrap 路径 `CREATE TABLE IF NOT EXISTS migration` + 事务内 `sqlite_master` 查 `session` 表复核，命中则降级 `applyOnly`）；沿用 `INSERT OR IGNORE` 幂等写入与模块级 `Semaphore`（进程内串行）（上游若已做可取上游版本） |
| `packages/core/src/database/database.ts` (并发冷启动健壮性) | 中 | 保留 `PRAGMA busy_timeout = 5000` 前置于 `journal_mode = WAL`；WAL 排他切换加有界重试 `Schedule.exponential(25).pipe(jittered, while elapsed<5s)`，避免两进程冷启动同一文件时 `SQLITE_BUSY`（上游若已做可取上游版本） |
| `packages/opencode/src/cli/cmd/run/footer.prompt.tsx` (@ 补全 debounce) | 低 | 保留 `debouncedQuery` 100ms debounce（上游若已做可取上游版本） |
| `packages/opencode/src/cli/cmd/run/theme.ts` (muted 灰度对比度提升) | 低 | 保留 dark mode gray 200/220（上游若已做可取上游版本） |
| `packages/opencode/src/{plugin/openai/codex.ts,mcp/oauth-callback.ts,plugin/xai.ts,plugin/snowflake-cortex.ts}` (OAuth 回调 HTML 转义) | 中 | 保留 `escapeHtml()` 包裹 `error`/`error_description` 插值。上游删除 `core/src/oauth/page.ts`（统一转义页）后，fork 内联的 `Authorization failed: ${error}` 存在反射型 XSS；补 `@/util/html` 转义修复（上游若恢复统一转义页可取上游版本） |
| `packages/core/src/database/sqlite.node.ts` (Node 驱动语句缓存) | 中 | 保留 `Map<string, StatementSync>` LRU 缓存（`MAX_CACHED_STATEMENTS = 1000`），避免重复 prepare；移除冗余 `PRAGMA journal_mode = WAL`（统一到 `database.ts`）（上游若已做可取上游版本） |
| `packages/server/src/handlers/pty.ts` (PTY WebSocket 有界队列) | 低 | 保留 `Queue.bounded(1024)` + 溢出断连（防无界内存增长），上游 `unbounded` 存在长会话内存泄漏风险（上游若已做可取上游版本） |
| `packages/server/src/cors.ts` (CORS origin 精确匹配) | 低 | 保留精确正则匹配（`^https?:\/\/(localhost|127\.0\.0\.1):(\d+)$`）替代 `startsWith`，防 origin 欺骗（上游若已做可取上游版本） |
| `packages/server/src/auth.ts` (timing-safe 密码比较) | 低 | 保留 `crypto.timingSafeEqual` + 长度前置检查，防时序攻击（上游若已做可取上游版本） |
| `packages/core/src/control-plane/workspace.sql.ts` (project_id 索引) | 低 | 保留 `index("workspace_project_idx").on(table.project_id)`，加速 workspace 按 project 查询（上游若已做可取上游版本） |
| `packages/core/src/catalog.ts` (`available()` 接受 `api.settings.apiKey`) | 中 | 保留：V1 config 迁移把 `options.apiKey` 降为 `api.settings.apiKey` 且注册无连接的 env integration，导致可用性判定与模型解析（`session/runner/model.ts`）不一致、v2 写路径 `ModelUnavailableError`；回归测试 `packages/core/test/catalog.test.ts`（derives availability from api settings apiKey）；配套 fork 新增影子对比 harness `packages/opencode/test/server/session-shadow.test.ts`（v1/v2 写路径 parity）（上游若已做可取上游版本） |
| `packages/opencode/src/session/prompt.ts` (v1 prompt 桥接 v2 读投影) | 中 | 保留：`prompt()` 在 `experimentalEventSystem` 下发布 `session.next.prompted` + 每个 synthetic 文本部分一条 `session.next.synthetic`，使 v1 会话对 `SessionV2.messages`（`session_message` 投影）可见；实现的是上游被跳过测试 `test/session/prompt.test.ts`「prompt emits v2 prompted and synthetic events」定义的合同（已解除 skip），并同步改写「legacy prompt ... without session.next events」为桥接后合同（上游若实现同等桥接则取上游版本并还原测试） |
| `packages/schema/src/session-event.ts` + `packages/core/src/session/runner/llm.ts` (v2 drain 失败 live 事件 `session.next.failed`) | 中 | 保留：新增 live-only `SessionEvent.Failed`（不入 durable manifest/不投影），`SessionRunner.run` 失败（非纯中断 cause）时发布，覆盖 step 开始前的失败（如 `ModelUnavailableError`）——此前 drain 失败仅 `execution/local.ts` logError，客户端不可见；step 内失败仍由 durable `Step.Failed` 结算（会双发，与 v1 `session.error` + assistant error 双通道一致）；测试 `packages/core/test/session-runner.test.ts`（publishes a live failed event when a drain fails）；连带更新 manifest 计数测试（schema 侧原本在 HEAD 即过期失败，修正为真实计数 89/59/35）+ SDK v2 重新生成（上游 runner 若补 durable 状态事件则取上游版本并移除本事件） |
| `packages/tui/src/context/sdk.tsx` + `packages/sdk/js/src/v2/gen` (移除残留 `/sync/*` SDK 面) | 低 | 保留：fork 早前裁剪了 server `/sync/*` 路由，但 SDK gen 与 TUI `sdk.sync.start()`（实验 flag 下静默 404）未同步；本次 SDK 重新生成后一并删除 TUI 调用点（上游 sync 面回归时随上游恢复） |
| `packages/core/src/{session.ts,session/compaction.ts,session/history.ts,session/runner/*}` (v2 手动 compact 实现) | 中 | 保留：实现 `SessionV2.compact`（原 stub 恒 `OperationUnavailableError`），spec `specs/v2/session.md:105` 已列为 sanctioned improvement。`SessionCompaction.make` 抽出共享 `summarize` 核心（`reason: "auto"\|"manual"`），新增 `compactManually`（输出预算取 `model.route.defaults.limits?.output`，可选 `instructions` 折入 `buildPrompt`）；`SessionHistory.load` 改由新导出 `entries()`（读 epoch `baseline_seq` 只读，不触发 SystemContext 初始化）派生；`SessionRunner` 接口新增 `compact`，`SessionV2.compact` 经 `locations.get(session.location)` 路由，失败/无可压缩内容统一映射 `OperationUnavailableError`（HTTP 503 文案不变）。已知限制：手动 compact 不经 `SessionRunCoordinator` 串行化，与进行中 drain 并发时下一 turn 才生效；测试 `packages/core/test/session-runner.test.ts`（manually compacts on demand / returns false when nothing to compact）（上游实现 v2 手动 compact 后取上游版本） |
| `packages/core/src/{session.ts,session/run-coordinator.ts,session/execution.ts,session/execution/local.ts}` (v2 `SessionV2.wait` 实现) | 低 | 保留：实现 `SessionV2.wait`（原 stub 恒 `OperationUnavailableError`）。逐字对齐上游 in-flight 提交 `5e90a68d6a`（wip(core): v2 subagent foundations）：`SessionRunCoordinator.awaitIdle`（await entry `done` + `Effect.exit` 吞掉失败/中断、循环复查 successor 直到 idle，空闲即 no-op、不发起 drain），`SessionExecution.awaitIdle` 透传，`SessionV2.wait` 委托并收窄为 `NotFoundError`，server handler 移除死的 503 映射，literals 移除 `"wait"`（对齐 `bd8d858bf7` 前态）。语义限制：仅覆盖本进程持有的执行；测试为 fork 补充（上游 wip 无测试）：`packages/core/test/session-run-coordinator.test.ts`（awaitIdle 4 例）+ `packages/opencode/test/server/httpapi-session.test.ts`（wait 改期望 204）（上游该分支合入后按上游版本对齐） |
| `packages/{schema,core,protocol,server}/src/**` + `packages/sdk/js/src/v2/gen` (v2 `SessionV2.skill` 实现) | 中 | 保留：实现 `SessionV2.skill`（原 stub 恒 `OperationUnavailableError`）。逐字移植上游 in-flight 提交 `23adaaaeab`（feat(core): add native skill activation）：durable `SessionEvent.Skill.Activated` + `SessionMessage.Skill` + projector/message-updater/to-llm-message/compaction 全链路，`SessionV2.skill` 经 `locations.get(session.location)` 解析 `SkillV2.list()`、未命中报 `Session.SkillNotFoundError`、`resume !== false` 时 fork `execution.resume`，协议新增 `POST /api/session/:sessionID/skill`（404 `SkillNotFoundError`）+ server handler + SDK v2 重新生成。未移植部分：TUI skill UX（依赖上游更新的 useLocation 管线）、report skill、cli daemon、plugin skill.ts、packages/client gen。测试为 fork 补充：`packages/core/test/session-create.test.ts`（activates a known skill as a durable skill message）+ httpapi-exercise/httpapi-session 覆盖；manifest 计数随 durable 事件 +1（60/90/90/36）（上游该分支合入后按上游版本对齐） |
| `packages/{core,protocol,server}/src/**` + `packages/sdk/js/src/v2/gen` (v2 `SessionV2.shell` 实现) | 中 | 保留：实现 `SessionV2.shell`（原 stub 恒 `OperationUnavailableError`）。结构逐字对齐上游提交 `bd8d858bf7`（feat(core): implement V2 session.shell）：`KeyedMutex` 按 Session 串行、`activeShells` 抑制 shell 期间 prompt wake、`execution.awaitIdle` 等待在跑 drain、durable `Shell.Started`/`Shell.Ended`（事件在 HEAD 已入 manifest，计数不变）、`Effect.ensuring` 清理 + `execution.wake`，协议新增 `POST /api/session/:sessionID/shell`（404 `SessionNotFoundError`）+ server handler + SDK v2 重新生成。唯一偏离：`runShellCommand` 内部用 HEAD 已有原语 `AppProcess.run` + `Shell.preferred`/`Shell.args`（v1 用户 shell 语义：config shell、TERM=dumb、extendEnv、stdin ignore、forceKillAfter 3s、合并输出、1MiB 截断、`AppProcessError` 捕获为输出文本）替代上游尚未移植的 location `Shell.Service`（`5ae93092aa`）；`core/src/shell.ts` 保持原样。测试为 fork 补充：`packages/core/test/session-create.test.ts`（shell 3 例）+ httpapi-exercise/httpapi-session 覆盖（上游 `5ae93092aa`+`bd8d858bf7` 移植后取上游版本） |

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

### 其他

| 冲突来源 | 频率 | 处理方式 |
|---------|------|---------|
| TS 壳接口签名变化 | 低 | 同步更新 TS 壳 |
| 上游新增工具协议 | 中 | 按第 ③ 类用途审计后决定 |

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
