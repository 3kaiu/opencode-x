# opencode-x — Merge / Sync 手册

> **给 AI 的阅读指南**：每次 sync 上游（`git merge upstream/dev`）时按本文执行。它回答三个问题：**① sync 前要准备什么；② 冲突如何分诊裁决；③ 每个 fork 决策记录在哪、下次如何复审**。PLAN.md 定义「意图」，本文件定义「执行」。
>
> **核心流程一句话**：fetch → merge → 跑 `merge-clean` 重删 → `bun install` → typecheck/测试 → 五类分诊 → 回写决策日志 → commit（标注 baseline）。

---

## 1. 准备

```bash
git fetch upstream
# 若新 clone：先建立 graft（fork root commit 挂在基线 tag 上）
BASELINE=v1.18.2
ROOT=$(git log --oneline --all | tail -1 | awk '{print $1}')
git replace --graft "$ROOT" "$BASELINE"
```

## 2. 执行 sync

```bash
git merge --no-ff upstream/dev --no-edit
bun script/merge-clean.ts          # 清单驱动重删上游带回的已删路径 + 残留扫描
bun script/merge-clean.ts --check  # 只报告
bun install                        # 重建 bun.lock（绝不手动合）
```

`merge-clean.ts` 退出码非 0 = 有禁用依赖回包 / 残留接线，按报告逐项处理后重跑。

## 3. 五类分诊（每个冲突/差异的裁决框架）

| 类 | 判定 | 处理 |
|---|---|---|
| ① 落在已删模块 | 上游改了已删包/已删文件 | merge-clean 自动 `git rm`，零人工 |
| ② 上游 bug 修复 | 位于保留模块 | 直接取上游；若落在 fork 已偏离代码 → 转④ |
| ③ 上游新特性/新包/新依赖 | 不在已删清单 | 用途审计（PLAN.md §1.3）：个人有用→引入；云/企业/前端/遥测/无消费方→拒绝并加入 merge-clean 清单；存疑→引入标记观察，下次复审 |
| ④ 双方共改同一处 | fork 与上游都改了 | 对抗审计（§4），裁决取上游/保留 fork/融合，结果登记 §6 |
| ⑤ 上游纯重构 | 无行为变化 | 默认跟随（降未来冲突面）；把已删模块重新接线的部分按①处理 |

## 4. 对抗审计优先级

1. 正确性（是否修真实缺陷、边界完整）
2. 行为完整性（功能覆盖面、空/加载/错误/降级状态）
3. 性能（有争议才基准，不凭直觉）
4. 可维护性（惯例一致、依赖少、易跟随上游）
5. 契合精简原则（不引入 fork 不需要的复杂度）

## 5. 冲突解决铁律（历史教训）

1. **禁止 blanket `git rm`**——曾误删 10+ 子包 package.json 与 bun.lock
2. **逐文件解决冲突**，不用批量 `git rm`/`git add .`
3. **bun.lock 只重生成**（`bun install`），不手动编辑
4. 先提交冲突解决，再处理细节修复
5. commit message 标注 baseline：`chore: sync upstream to <baseline>`

## 6. 决策日志（偏离清单，活文档）

> **维护规则**：每次 sync 后必须回写。上游吸收/实现了等价物 → 移除条目；载体文件消失 → 移除；新裁决 → 新增。**热点区**（`ripgrep.ts`/`tool/grep.ts`、`bus.ts`+`event.ts`、`session/runner/*`、`session/execution/*`）若上游触及，优先并排比对。

### 6.1 结构性删除（merge-clean 清单，自动维持）

- **已删包 20 个**：`app, cli, client, console, containers, desktop, docs, effect-sqlite-node, enterprise, function, httpapi-codegen, identity, script, sdk-next, session-ui, slack, stats, storybook, ui, web`（清单维护在 `script/merge-clean.ts` 顶部）
- **opencode 内删**：`acp/`、`account/`、`sync/`、`share/`、`plugin/github-copilot/`、`server/mdns.ts`、`cli/cmd/{github.*,pr,web,acp,account}.ts`
- **core 内删**：`github-copilot/`、`oauth/`、`observability/otlp.ts`、`plugin/provider/{amazon-bedrock,cloudflare-*}.ts`
- **tui 内删**：`routes/session/{sidebar,footer,status-bar,dialog-subagent}.tsx`、`feature-plugins/sidebar/*`、`component/{curve-spinner,dialog-tag}.tsx`、`component/prompt/cwd.ts`、`ui/primitives.tsx`、`util/{animation,curve-engine,layout,responsive}.ts`
- **依赖禁入**：`@opentelemetry/*`、`@openauthjs/*`、`@actions/*`、`@octokit/*`、`@agentclientprotocol/*`、`bonjour-service`、`chokidar`、`@gitlab/opencode-gitlab-auth`
- **已恢复（不在删除清单）**：`cli/cmd/{import,stats}.ts`、`test/cli/import.test.ts` —— **注意：上游 sync 带回的是带 URL/ShareNext 的原版，恢复 fork 版时须重新裁剪**（本地文件导入 only）
- **命令注册**：`index.ts` 已注册 `import`/`stats`；`help-snapshots.test.ts` TOP_LEVEL 含 `import`/`stats`

### 6.2 行为与加固偏离（core/opencode/server/llm）

| 文件/区域 | 偏离内容 | 复审条件 |
|---|---|---|
| `observability.ts` | `Layer.empty` 修复 | 上游若做 |
| `session/retry.ts` | `RETRY_MAX_DELAY = 300_000`（上游 2^31-1） | 上游若做 |
| `run/stream.transport.ts` | `MAX_BUFFERED = 500` 防无界积累 | 上游若做 |
| `ripgrep.ts` + `tool/grep.ts` | 30s 超时 + 有界行框界 + grep `DEFAULT_LIMIT=100` | 上游若做（**热点区**） |
| `{event.ts → bus.ts}` | 纯改名，event.ts 桥接转发 | 上游若做 |
| `database/migration.ts` | 跨进程 claiming 竞态闭合（事务内复核） | 上游若做 |
| `database/database.ts` | busy_timeout 前置 + WAL 重试 | 上游若做 |
| `run/footer.prompt.tsx` | @ 补全 100ms debounce | 上游若做 |
| `run/theme.ts` | dark gray 200/220 对比度 | 上游若做 |
| 4 处 OAuth 回调（codex/xai/snowflake/mcp） | `escapeHtml()` 防 XSS（因 fork 删了统一转义页） | 上游若恢复统一转义页 |
| `database/sqlite.node.ts` | LRU 语句缓存 + 复用 | 上游若做 |
| `server/handlers/pty.ts` + httpapi pty | `Queue.dropping(1024)` + 溢出断连 | 上游若做 |
| `server/cors.ts` | origin 精确正则匹配 | 上游若做 |
| `server/auth.ts` + opencode auth | timing-safe 密码比较 | 上游若做 |
| `control-plane/workspace.sql.ts` | project_id 索引 | 上游若做 |
| `catalog.ts` | `available()` 接受 `api.settings.apiKey` | 上游若做 |
| `session/prompt.ts` | v1 prompt 桥接 v2 读投影 | 上游若实现同等桥接 |
| `session-event.ts` + runner/llm | live 事件 `session.next.failed` | 上游若补 durable 状态事件 |
| `v1/config/migrate.ts` | provider 可用性列表→v2 策略迁移 | 上游若做 |
| `session/runner/model.ts` | Google→Gemini 原生路由 | 上游若原生支持 |
| `v1/config/config.ts` | `batch_tool` 无消费者 | 跟随上游，不处理 |
| `database/sqlite.{bun,node}.ts` | `executeStream()` 死 stub | 跟随上游，不处理 |
| `codemode/src/openapi/` | 无人消费导出 | 跟随上游，不处理 |
| `tui/parsers-config.ts` | HTML injections 注释 | 跟随上游，不处理 |
| `test/provider/gitlab-duo.test.ts` | 整文件注释 | 跟随上游，不处理 |
| `core/config.ts:75` | `lsp` 字段无读取者 | 跟随上游，不处理 |
| `llm/llm.ts` + providers facades | 仅测试可达 API | 跟随上游，不处理 |
| `control-plane/workspace.ts` + workspace-routing | 远程同步移除（local-only） | 上游若恢复远程同步 |

### 6.3 fork 自有实现（上游尚无对应物）

| 实现 | 内容 | 复审条件 |
|---|---|---|
| v2 `SessionV2.compact` | 手动 compact（原 stub） | 上游实现后取上游 |
| v2 `SessionV2.wait` | awaitIdle（对齐上游 in-flight `5e90a68d6a`） | 上游合入后对齐 |
| v2 `SessionV2.skill` | 逐字移植上游 in-flight `23adaaaeab` | 上游合入后对齐 |
| v2 `SessionV2.shell` | 对齐上游 `bd8d858bf7`，用 HEAD 原语替代 location Shell.Service | 上游移植后取上游 |
| 插件 `ctx.event.subscribe` | 事件订阅（经 EventManifest 解析） | 上游若做则对抗审计 |
| 插件 `ctx.tool.hook` | execute.before/after 运行时钩子 | 上游若给出官方设计 |
| `SessionToolPermissions` | per-session 工具权限覆盖接缝 | 上游若提供机制 |
| `session/runner/mutation-queue.ts` | 在线 per-file 串行队列 + exclusive gate（M3 在线化：同文件写串行/异文件并行/bash 与写互斥），`Effect.ensuring` 而非 acquireRelease（v4 beta release 绑定 scope） | 上游若实现同等调度 |
| runner autoVerify + sediment | M9 写路径自动验证（durable Synthetic 注入）+ 验证失败自动沉淀教训（recordPending 去重） | 上游若实现同等闭环 |
| `system-context/builtins.ts` core/v2-memory | M5 记忆注入：confirmed 教训按工作区（Global.data/v2/hash）注入 L3 | 上游若实现记忆层 |
| runner M8 goal 模式 | session.metadata.goal：system 注入 + 写后即停续推（上限 3）防提前收尾 | 上游若实现 goal 驱动 |
| `cli/cmd/v2.ts` | durable 会话 + goal 模式 CLI（共享 DB/TUI 可见） | 上游若提供 headless 会话入口 |
| Session.Info.metadata | session 行 metadata 暴露（goal 载体） | 上游若加字段则对齐 |
| v2 子代理 durable 管线 | live 事件 requested/result + 全局 `SubagentExecutor` | 上游插件形态稳定后收敛 |
| v2 MCP 工具注册 | 依赖反转：core 定义接口，opencode 提供实现 | 上游提供 V2 MCP 后收敛 |
| `SessionV2.create` parentID/title | 移植上游 `5e90a68d6a` create 切片 | 上游合入后对齐 |
| runner 三.1 切片 | 重复 tool 调用限界 + ensureTitle + usage 累计 | 上游若补同等实现 |
| bash 三.2 切片 | BashArity 前缀审批 + 二进制输出 + 进程组验证 | 上游若实现同等功能 |
| edit/write 三.3 | 发布 `file.edited` 事件 | 上游若实现同等事件 |
| permission 三.4 | `permission.ask` hook 接线（V1） | V2 支持需单独设计 |

### 6.4 安全修复轮（已修，供复审）

- provider 响应 `key` 外泄 → redactKey
- operationId 双端点冲突 → 已改名
- V2 runner 未读 SessionToolPermissions → 已修
- settleWith StorageError 兑底 → 降级有损输出
- 假 spawn_agent 工具链 → 删除
- V1 shell timeout 上限 / V1 websearch 有界响应 → 已修
- V1 apply_patch CAS → 已修
- TUI data.tsx SSE 优雅关闭 → 已修
- llm Stream.catchCause 吞中断 → 已修
- 实例路由密码 timing-safe → 已修
- Config V2 写回 `opencode.json` 探测 → 已修
- UI 回退代理 stripCredentials → 已修
- amazon-bedrock env 泄漏 → 改 apiKey option
- waitForPromotion 挂死 → no-op
- ToolOutputStore.cleanup 误删远古 → 跳过无 mtime
- node sqlite 缓存 FIFO→LRU → 已修
- LLM 流式 stallTimeout（5min）→ 已修
- models-dev.fresh() 时钟回拨 → 已修

### 6.5 依赖卫生（跟随上游，不处理）

- 12 个零引用依赖（含 5×otel、zip.js、solid-primitives 等）— 上游同款
- 错位依赖 glob/mime-types/xdg-basedir — 上游同款
- 7 个 stale patch — 上游同款
- 17 个死 catalog 条目 — 上游同款
- minimatch 双版本 — 上游同款
- 重复代码（isDefaultTitle/webSearchProviderLabel/GPT-5 policy/MCP sanitize）— 上游同款或刻意保留
- AGENTS.md 生成命令 — **fork 特有修正**：`bun dev generate` from packages/opencode

## 7. 合并后验证（全过才 commit）

```bash
bun script/merge-clean.ts
bun install
bun run --cwd packages/core typecheck
bun run --cwd packages/opencode typecheck
bun run --cwd packages/llm typecheck
bun run --cwd packages/tui typecheck
cd packages/tui && bun test
bun ./packages/sdk/js/script/build.ts   # 若 HttpApi 有变更，重生成 SDK
cd packages/opencode && bun test test/cli/help   # 命令变更时重生成快照
```

commit：`chore: sync upstream to <baseline>`

## 8. sync 收尾清单

- [ ] 五类分诊全部处理完毕（无未裁决冲突）
- [ ] 对抗审计结果已回写 §6
- [ ] 上游已吸收的偏离条目已移除
- [ ] 新拒绝路径已入 merge-clean 清单 + PLAN.md §3.2
- [ ] 合并后验证全部通过
- [ ] PLAN.md/MERGE.md 已复核（基线、新包、新决策）——无需更新则 commit 说明里写「PLAN/MERGE 已复核，无需更新」
- [ ] **热点区**（ripgrep/bus/runner/execution）上游有触及 → 并排比对过
- [ ] **import/stats 恢复文件确认**：上游若带回了 ShareNext 版 import，重新裁剪
- [ ] commit message 标注 baseline

## 9. 已登记决策明细（历史裁决记录，供复审上下文）

### 9.1 TUI 偏离（四批 23 轮，面状 ~80+ 文件）

总体：TUI 冲突一律走 ④ 对抗审计；fork 修复多为一致性/状态完整性改进，上游同等修复优先取上游。要点：

- `error-component.tsx`：issue URL 指向 fork 仓库（永久偏离）
- `theme/index.ts`：overlay 变量 + selectedForeground helper + markdownCodeBlock 面板
- `ui/dialog*.tsx`、`dialog-select`、`dialog-help`：响应式布局/当前项色/快捷键分类
- `routes/session/index.tsx`：revert 边框、ThinkingScanner、代码块分段/流式防闪/reasoning markdown、Skill/summary、会话加载态
- `routes/session/subagent-footer.tsx`：agent 色带 + 状态点 + agent-color
- 新增：`component/message/primitives.tsx`（Bullet/ResultBlock/CollapsedHint）、`component/prompt/creating-dots.ts`（useCreatingDots）、`ui/glyphs.ts`（GLYPH 常量）、`util/markdown.ts`（LLM markdown 打磨）
- 逐文件打磨轮 1–12：spinner 克隆、selectedForeground 响应式、collapse-tool-output 负防护、app-commands KV 快照、clipboard DCS、$EDITOR 引号、filetype 后缀、frecency reconcile、kv 存在性检查、data.tsx 事件 catch、locale slice(-0)、expandPastedTextPlaceholders `$&` 修复等（详见 git log 各轮 commit）

### 9.2 死代码删除批（路径在 merge-clean 清单）

`bootstrap-runtime.ts`、`util/repository.ts`、`storage/schema.ts`、`session/message.ts`、`dream/`、`ide/`、`util/{defer,signal}.ts`、`debug-workspace-plugin.ts`、`session/{wire,fork}.ts`、`data-migration.sql.ts`、`public-event-manifest.ts`、`plugin/layer-map.example.ts`、`subagent/index.ts`、`v2-schema.ts`、`util/{array,binary,iife,path,retry}.ts`、`memory/dream.ts`、`server/src/routes.ts`、`tui/util/icon-pixel-data.ts`、`tui/util/format.ts`、`tui/util/locale.ts pluralize`、`design-tokens MESSAGE_INDENT_BORDERED`、`keybind Descriptions`、40/45 音频 mp3

> **修正记录（2026-08-03）**：`core/src/session/context-levels.ts` **不是死代码**——fork 新增的 V2 压缩分级模块（`c925f5c3d5` 引入，上游无此文件），被 `compaction.ts`/`runner/llm.ts` 引用，仅 `estimateRequestTokens` 导出被删。
>
> **修正记录（2026-08-03）**：`core/src/oauth/page.ts` 的删除依据曾误记「上游 a2b5baf793 已删除」——实为 **fork 自己** Batch 4 删除（a2b5baf793 是 fork commit），上游 v1.18.9 至今始终存在该文件。fork 用内联 escapeHtml 替代，删除自洽，维持删除。

### 9.3 模块深度审计轮（2026-08，fork 自有改进）

- **CRITICAL**：subagent 事件入 manifest；SubagentExecutor 生产接线；pty connect `Queue.offerUnsafe`
- **HIGH**：bash 审批段切分 + EXECUTE_WRAPPERS；grep/glob Location containment；tool-output 清扫接线；TUI SSE 自毁订阅；SessionV2.fork durable 化；HTTP 错误不泄露 `Cause.pretty`
- **MED**：retry cap 旁路；progress 事件 producer；bus allBounded 丢弃；ripgrep 超长记录丢弃；search O(n²)→惰性；sqlite setReturnArrays；SUBAGENT_READONLY_RULES 动作名；BackgroundJob 竞速；compact 日志；ensureTitle detached
- **LOW/死代码**：coordinator.ts、prepareNextTurn、thinking-level.ts、plugin v2/effect 四模块、ide-event.ts、encode base64、killTree、estimateContextTokens、limiter 计数、memory CRUD、setShare/Session.diff、experimentalReferences
- **判定不处理**：webfetch URL 校验（非缺陷）；v1→v2 Synthetic 桥接（不可达）；PermissionV2.ask 钩子（待单独设计）；awaitToolFibers（回退保留）

### 9.4 已知遗留

- `sessions.events` durable replay 分页 ✅ 已解决；每次 wake 瞬时突发整读仍登记
- session-runner-recorded 测试 ✅ 已修复（get_tool_schema 对齐 cassette）
- auto-compact 测试 ✅ 已修复（校准 2300/188 恢复 + compaction 跳过 L2/L3）
- 手动 compact 与进行中 drain 串行化 — 已知限制
- 背景子代理 durable 恢复/认领 — deferred（specs/v2/todo.md）
