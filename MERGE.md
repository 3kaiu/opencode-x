# Merge 策略

## 背景

opencode-x 是基于 [anomalyco/opencode](https://github.com/anomalyco/opencode) 的 fork，需要定期合并上游更新。

## 远程配置

```bash
git remote add upstream https://github.com/anomalyco/opencode.git
git fetch upstream
```

## 合并流程

```bash
git fetch upstream
git merge --no-edit upstream/dev
```

## 冲突分类与处理策略

| 冲突来源 | 频率 | 处理方式 |
|---------|------|---------|
| `packages/app/`, `packages/desktop/`, 等已删包 | 每次 | `git rm --cached` 保留删除 |
| `packages/opencode/src/{acp,sync,share}/`, `cli/cmd/{github.*,pr,web,acp,import}.ts`, `server/mdns.ts` | 每次 | `git rm` 保留删除（个人定位剔除） |
| `bun.lock` | 中 | `bun install` 重新生成 |
| `package.json` (workspaces) | 低 | 手动合入，保持 `packages/*` workspace 不变 |
| `packages/opencode/package.json` (依赖) | 中 | 手动合入，保留 opencode-x 特有依赖；已删 `@actions/*`、`@octokit/*`、`@agentclientprotocol/*`、`bonjour-service`、`chokidar`、`@gitlab/opencode-gitlab-auth` |
| `packages/core/package.json` (依赖版本) | 中 | 手动合入，保留 opencode-x 特有依赖 |
| `packages/core/src/observability.ts` | 低 | 保留 `Layer.empty` 修复 |
| `packages/llm/src/route/transport/http.ts` | 低 | 保留 Rust SSE 注入 |
| `packages/opencode/src/session/retry.ts` (RETRY_MAX_DELAY cap) | 中 | 保留 `RETRY_MAX_DELAY = 300_000`（fork 行为修改，上游默认 2^31-1） |
| `packages/opencode/src/cli/cmd/run/stream.transport.ts` (MAX_BUFFERED cap) | 中 | 保留 `MAX_BUFFERED = 500` + `pushBuffered()` helper（fork 行为修改） |
| `packages/opencode/src/session/session.ts` (share_url 字段保留) | 中 | 保留 `share_url` 读写（DB 兼容，fork 删 share 模块但保留 schema 列） |
| `packages/core/src/ripgrep.ts` (执行超时 + stdout 字节上限) | 中 | 保留 `EXECUTION_TIMEOUT` + `MAX_STDOUT_BYTES` + `stdoutCapped` 逻辑（todo.md deferred hardening，上游若已做可取上游版本） |
| `packages/core/src/event.ts` (durable replay 分页 + RcMap wake) | 中 | 保留 `readAfterStream` + `REPLAY_PAGE_SIZE` + `rowToEvent` + `durable()` historical 改 stream + `RcMap` 替换 `Map<string, Set<PubSub>>`（todo.md deferred hardening，上游若已做可取上游版本） |
| `packages/core/src/database/migration.ts` (跨进程 fenced claiming) | 中 | 保留 `{ behavior: "immediate" }` + 事务内 re-check（todo.md deferred hardening，上游若已做可取上游版本） |
| `packages/tui/src/component/error-component.tsx` (issue URL) | 低 | 保留 `https://github.com/3kaiu/opencode-x/issues/new`（fork 偏离，上游指向 anomalyco/opencode） |
| `packages/tui/src/routes/session/message.tsx` (错误文字配色 + 消息对齐 + reasoning hover) | 中 | 保留 `theme.error` 替代 `theme.textMuted`、UserMessage `paddingLeft=3` 对齐、ReasoningPart hover 高亮（fork 视觉改进，上游若已做可取上游版本） |
| `packages/opencode/src/cli/cmd/run/footer.prompt.tsx` (@ 补全 debounce) | 低 | 保留 `debouncedQuery` 100ms debounce 逻辑（fork 性能改进，上游若已做可取上游版本） |
| `packages/opencode/src/cli/cmd/run/theme.ts` (muted 灰度对比度提升) | 低 | 保留 dark mode gray 200/220（fork 视觉改进，上游若已做可取上游版本） |
| `packages/opencode/src/cli/cmd/run/stream.transport.ts` (fail 内联错误) | 中 | 保留 `fail()` 中 `input.footer.append({ kind: "error" })` 内联错误显示（fork UX 改进，上游若已做可取上游版本） |
| `packages/tui/src/ui/dialog-help.tsx` (Help Dialog 快捷键分类) | 低 | 保留按类别分组的快捷键显示（fork UX 改进，上游若已做可取上游版本） |
| `packages/tui/src/component/dialog-session-list.tsx` (会话列表空状态 + 删除确认) | 低 | 保留空状态和搜索无结果的 contextual 消息、删除确认加 `✗` 前缀（fork UX 改进，上游若已做可取上游版本） |
| `packages/tui/src/routes/session/sidebar.tsx` (响应式宽度 + 状态指示器 + agent/model 信息) | 中 | 保留响应式 sidebar 宽度（36/42/48 三档）、session 状态图标（◔ busy/⊙ retry/● idle）、agent 名称+颜色、model 名称显示、版本标记 `●`（fork UX 改进） |
| `packages/tui/src/routes/session/index.tsx` (sidebar 宽度联动 + revert 边框) | 低 | 保留 `sidebarWidth` 动态计算与 `contentWidth` 联动、revert banner 边框颜色改为 `theme.border`（fork 配套改动） |
| `packages/tui/src/routes/session/footer.tsx` (agent/model/thinking 状态栏) | 中 | 保留左侧 agent 名称+颜色、model 名称、thinking 模式指示器（◈ think）、session 状态图标（◔ busy/⊙ retry）、LSP/MCP 标记 `●`（fork UX 改进） |
| `packages/tui/src/routes/session/tools.tsx` (工具图标差异化 + 运行时间 + 待处理样式) | 中 | 保留工具图标差异化（Grep `⊕`/WebFetch `⊹`/ApplyPatch `≡`/TodoWrite `☰`/Skill `⚡`/Write `↓`）、Task/Execute 运行中图标 `◔`、InlineToolRow 待处理改为图标+文字、BlockTool 边框 `theme.border`、hover 背景 `backgroundElement`、失败工具 hover 变白、Task 运行中显示 elapsed 时间（fork UX 改进） |
| `packages/tui/src/routes/session/subagent-footer.tsx` (agent 色带 + 状态点 + 按钮样式) | 中 | 保留 agent 专属颜色边框、状态点图标、紧凑索引显示（1/3 格式）、导航按钮加方向箭头+背景色优化（fork UX 改进） |
| `packages/tui/src/routes/session/message.tsx` (消息对齐 + reasoning hover) | 中 | 保留 UserMessage `paddingLeft=3` 与 assistant 内容对齐、ReasoningPart 可折叠区域 hover 背景高亮（fork UX 改进） |
| `packages/tui/src/routes/session/permission.tsx` (权限图标匹配) | 中 | 保留权限图标与工具图标一致（bash `$`/task `◔`/grep `⊕`/webfetch `⊹`）（fork UX 改进） |
| `packages/tui/src/component/dialog-session-list.tsx` (删除确认视觉) | 低 | 保留删除确认加 `✗` 前缀增强视觉反馈（fork UX 改进） |
| `packages/tui/src/feature-plugins/sidebar/lsp.tsx` (状态标记统一) | 低 | 保留 LSP 状态标记 `●`（fork 视觉统一） |
| `packages/tui/src/feature-plugins/sidebar/mcp.tsx` (状态标记统一) | 低 | 保留 MCP 状态标记 `●`（fork 视觉统一） |
| `packages/tui/src/feature-plugins/sidebar/footer.tsx` (版本标记统一) | 低 | 保留版本标记 `●`（fork 视觉统一） |
| `packages/tui/src/audio.ts` (音频错误日志级别) | 低 | 保留 `console.error` 替代 `console.debug`（fork 可观测性改进，上游若已做可取上游版本） |
| `packages/tui/src/attention.ts` (通知错误日志级别) | 低 | 保留 `console.error` 替代 `console.debug`（fork 可观测性改进，上游若已做可取上游版本） |
| `packages/tui/src/component/command-palette.tsx` (命令面板空状态) | 低 | 保留空状态和搜索无结果的 contextual 消息（fork UX 改进，上游若已做可取上游版本） |
| `packages/tui/src/theme/index.ts` (overlay 颜色变量) | 低 | 保留 `overlay` 和 `overlayLight` 颜色变量（fork 主题增强，上游若已做可取上游版本） |
| `packages/tui/src/ui/dialog.tsx` (响应式布局 + overlay) | 低 | 保留 `Math.max(1, ...)` 顶部间距、`Math.max(40, ...)` 最大宽度、`theme.overlay`（fork 视觉改进，上游若已做可取上游版本） |
| `packages/tui/src/routes/session/index.tsx` (侧边栏 overlay) | 低 | 保留 `theme.overlayLight`（fork 视觉改进，上游若已做可取上游版本） |
| `packages/tui/src/ui/dialog-select.tsx` (当前项标记颜色) | 低 | 保留 `theme.primary` 作为当前项标记颜色（fork 视觉改进，上游若已做可取上游版本） |
| `packages/opencode/src/index.ts` (cmd 注册) | 中 | 手动合入，保持已删命令的注册移除 |
| `packages/opencode/src/server/server.ts` (mdns 移除) | 低 | 保留 mdns/setupMdns 移除 |
| `packages/opencode/src/server/routes/instance/httpapi/handlers/session.ts` (share/unshare 移除) | 中 | 保留 share/unshare handler 和 SessionShare import 移除 |
| `packages/opencode/src/server/routes/instance/httpapi/groups/session.ts` (share/unshare endpoint 移除) | 中 | 保留 share/unshare endpoint 和 SessionPaths.share 移除 |
| `packages/opencode/src/cli/cmd/run.ts` (--share 选项移除) | 中 | 保留 --share 选项和 share() 函数移除 |
| `packages/opencode/src/effect/{app-runtime,bootstrap-runtime,runtime-flags}.ts` (share layer 移除) | 中 | 保留 ShareNext/SessionShare/autoShare 移除 |
| TS 壳接口签名变化 | 低 | 同步更新 TS 壳 |
| 上游新增工具协议 | 中 | 可选添加 Rust 实现 |

### 已删包列表（合并时自动处理）

以下包在 opencode-x 中已删除，合并时会出现 `modify/delete` 冲突：
- `packages/app/`
- `packages/desktop/`
- `packages/slack/`
- `packages/enterprise/`
- `packages/web/`
- `packages/function/`
- `packages/http-recorder/`
- `packages/httpapi-codegen/`
- `packages/console/`
- `packages/stats/`
- `packages/storybook/`
- `packages/containers/`
- `packages/identity/`

处理方式：`git rm <file>` 保留删除。

## 合并后验证

```bash
bun install
bun run build:all
bun run --cwd packages/core typecheck
bun run --cwd packages/opencode typecheck
bun run --cwd packages/llm typecheck
bun run --cwd packages/opencode --conditions=browser ./src/index.ts --version
```