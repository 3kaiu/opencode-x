# Merge 策略

## 背景

opencode-x 是基于 [anomalyco/opencode](https://github.com/anomalyco/opencode) 的精简 fork，需要定期合并上游更新。首次同步时 fork 与 upstream/dev 在不同的根提交上分叉，需要通过 graft 建立共同的基线。

自裁剪工程收尾后，合并进入**审计式吸收**常态：每次 sync 只提取并比对上游的新特性与问题修复，保留更新、更有用的实现；双方共改的模块通过对抗审计裁决最优实现。

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

> 每条注明处理方式；标注「上游若已做可取上游版本」的条目在每次 sync 时复审。数据基于 v1.18.2→v1.18.4 sync 与后续 fork 自有改进，随每次 sync 更新。

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
| `packages/opencode/test/cli/help/help-snapshots.test.ts` (命令清单) | 中 | 保留 acp/web/import/github/pr 从 TOP_LEVEL/SUBCOMMANDS 移除；快照变化时删除 `.snap` 后 `bun test test/cli/help` 重生成 |
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
| `packages/core/src/ripgrep.ts` (执行超时 + stdout 字节上限) | 中 | 保留 `EXECUTION_TIMEOUT` + `MAX_STDOUT_BYTES` + `stdoutCapped` 逻辑（上游若已做可取上游版本） |
| `packages/core/src/event.ts` (durable replay 分页 + RcMap wake) | 中 | 保留 `readAfterStream` + `REPLAY_PAGE_SIZE` + `rowToEvent` + `durable()` historical 改 stream + `RcMap` 替换 `Map<string, Set<PubSub>>`（上游若已做可取上游版本） |
| `packages/core/src/database/migration.ts` (跨进程 fenced claiming) | 中 | 保留 `{ behavior: "immediate" }` + 事务内 re-check（上游若已做可取上游版本） |
| `packages/opencode/src/cli/cmd/run/footer.prompt.tsx` (@ 补全 debounce) | 低 | 保留 `debouncedQuery` 100ms debounce（上游若已做可取上游版本） |
| `packages/opencode/src/cli/cmd/run/theme.ts` (muted 灰度对比度提升) | 低 | 保留 dark mode gray 200/220（上游若已做可取上游版本） |

### TUI 偏离（四批 23 轮审计打磨，全域）

`packages/tui/**` 经四批审计后与上游存在**面状偏离**（约 80+ 文件）：类型安全、floating promise 治理、死代码删除、主题色彩统一（`selectedForeground` helper）、间距/文案规范、空态/加载态语义化、动画开关（`animations_enabled`）全覆盖等。

**总体处理方式**：TUI 冲突一律走第 ④ 类对抗审计。fork 的修复多为一致性与状态完整性改进；上游若有同等或更完整实现（尤其上游修复了同类问题时）优先取上游，减少偏离面。以下为仍需单点关注的条目：

| 冲突来源 | 频率 | 处理方式 |
|---------|------|---------|
| `packages/tui/src/component/error-component.tsx` (issue URL) | 低 | 保留 `https://github.com/3kaiu/opencode-x/issues/new`（上游指向 anomalyco/opencode，永久偏离） |
| `packages/tui/src/theme/index.ts` (overlay 颜色变量 + selectedForeground) | 低 | 保留 `overlay`/`overlayLight` 变量与 `selectedForeground(theme)` helper（透明背景主题选中态对比度，上游若已做可取上游版本） |
| `packages/tui/src/ui/dialog.tsx` (响应式布局 + overlay) | 低 | 保留 `Math.max(1, ...)` 顶部间距、`Math.max(40, ...)` 最大宽度、`theme.overlay`（上游若已做可取上游版本） |
| `packages/tui/src/ui/dialog-select.tsx` (当前项标记颜色 + emptyView) | 低 | 保留 `theme.primary` 当前项标记、`emptyView` 自定义空态入口（上游若已做可取上游版本） |
| `packages/tui/src/ui/dialog-help.tsx` (快捷键分类) | 低 | 保留按类别分组的快捷键显示（上游若已做可取上游版本） |
| `packages/tui/src/component/dialog-session-list.tsx` (空状态 + 删除确认) | 低 | 保留 contextual 空态消息、删除确认 `✗` 前缀（上游若已做可取上游版本） |
| `packages/tui/src/component/command-palette.tsx` (命令面板空状态) | 低 | 保留 contextual 空态消息（上游若已做可取上游版本） |
| `packages/tui/src/routes/session/index.tsx` (revert 边框 + ThinkingScanner 复用) | 低 | 保留 revert banner 边框 `theme.border`、Thinking 头部复用 `ThinkingScanner`（动画开关覆盖）（上游若已做可取上游版本） |
| `packages/tui/src/routes/session/permission.tsx` (权限图标匹配) | 中 | 保留权限图标与工具图标一致（上游若已做可取上游版本） |
| `packages/tui/src/routes/session/subagent-footer.tsx` (agent 色带 + 状态点) | 中 | 保留 agent 专属颜色边框、状态点图标、紧凑索引、导航按钮样式（上游若已做可取上游版本） |
| `packages/tui/src/{audio,attention}.ts` (错误日志级别) | 低 | 保留 `console.error` 替代 `console.debug`（上游若已做可取上游版本） |
| `packages/tui/src/util/markdown.ts` + `test/markdown-polish.test.ts` (LLM markdown 打磨) | 低 | fork 新增（LaTeX→Unicode、CJK 强调符修复），保留；若上游引入同类能力对抗审计 |

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
- [ ] commit message 标注 baseline 版本
