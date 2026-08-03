# opencode-x V3 架构深度设计（全包模块级）

> **地位**：`architecture-v3.md`（能力视图）的深度细化版。每个包细化到**模块清单 + 关键接口 + 迁移来源 + 消费接线**；关键链路细化到**逐组件数据流**；路线图细化到**任务级 checklist**。
>
> **版本**：v3.3（2026-08-03 深度细化）

---

## 0. 设计原则（所有模块设计的裁决依据）

1. **消费方优先**：每个模块先回答「大脑用它获得什么能力」，再回答「怎么实现」
2. **一份实现**：任何能力只有一个模块承载（消灭双轨）；跨包复用走 schema 契约
3. **提升即接线**：从 v2/ 提升的算法必须同时接上消费点
4. **接口先于实现**：模块间只通过命名空间投影（`export * as`）交互，禁止跨模块深层引用
5. **安全是路径**：内容进大脑过 isolation→projection；行动出大脑过 permission→tool
6. **成本是预算**：任何注入内容的模块都要过预算语义（最小注入默认）

---

## 1. core 认知中枢 — 域级深度设计（C3–C14）

### 1.1 C4 投影域（system-context / instruction / compaction）

**目标模块**：

| 模块 | 职责 | 关键接口 | 迁移来源 | 接线 |
|---|---|---|---|---|
| `system-context/index.ts` | 上下文代数（Source/combine/initialize/reconcile） | `Source<A>{load, baseline, update, removed}` | 现有（保持） | — |
| `system-context/registry.ts` | 源注册 | `register({key, load})` | 现有（保持） | location services |
| `system-context/builtins.ts` | 内置源：env/date/记忆注入/语言偏好 | `load: Effect<EnvSnapshot\|date\|lessons\|locale>` | 现有 + 新增 locale | — |
| `instruction/context.ts` | 指令链（AGENTS.md 分层） | `load(): Effect<InstructionLayers>` | `instruction-context.ts`（更名收敛） | runner L2 |
| `projection/index.ts` | 六层投影纯函数 | `project(input: ProjectionInput): ProjectionResult{fingerprint, layers}` | `v2/context/projection.ts` 提升 | **runner buildRequest（P1 接线）** |
| `projection/budget.ts` | 分层预算分配 | `allot(task, window): ContextBudget` | `v2/context/budget.ts` 提升 | projection |
| `compaction/index.ts` | 压缩管道（可替换） | `pipe(entries): Compacted{summary, decisions}` | `session/compaction.ts` 改造 | runner 自动压缩 |
| `compaction/algorithms.ts` | 切点/增量摘要/白名单 | `findCutPoint/takeIncrementalSummary` | `v2/context/algorithms.ts` 提升 | compaction 管道 |
| `context-epoch.ts` | 基线不可变 + 换代 | `initialize/prepare/reset` | 现有（保持） | runner |

**turn 请求构造目标流程**（P1 后的 runner buildRequest）：
```
SessionHistory.entries → projection.project（六层：system/world/instructions/memory/history/live）
  → isolation.sanitize（数据角色标注）→ budget.allot（预算裁剪）
  → fingerprint（M12 决策记录）→ llm.request（stableSystem + cache hints）
```

### 1.2 C5 行动域（tool）

| 模块 | 职责 | 关键接口 | 迁移来源 | 接线 |
|---|---|---|---|---|
| `tool/registry.ts` | 注册表 + materialize + settle | `materialize(permissions): {definitions, settle}` | 现有（保持，删 v2 复制品） | runner |
| `tool/tool.ts` | 工具代数（不透明 Definition/单执行器） | `Tool.make({description,input,output,execute})` | 现有（保持） | — |
| `tool/contract.ts` | 契约扩展（幂等/访问/投影/失败分类/重试引导） | `ToolContract{idempotent, access, outputProjection, failure}` | `v2/tools/contract.ts` 提升 | registry 校验 |
| `tool/scheduler.ts` | 冲突图并行调度（批收集场景） | `planWaves(calls, tools, accessOf): waves` | `v2/tools/scheduler.ts` 提升 | 子代理批量 + 批收集 turn |
| `tool/mutation-queue.ts` | 在线 per-file 串行 + exclusive gate | `run(access, effect)` | 现有（已接入） | runner settle |
| `tool/access.ts` | 调用级访问推导 | `accessOfCall(call, baseDir): Access` | mutation-queue 内提取 | scheduler/mutation-queue |
| `tool/cache.ts` | 结果缓存 | `(tool, argsHash, mtimes) → cached` | `v2/tools/cache.ts` 提升 | settle |
| `tool/output-store.ts` | 有界输出（head/tail+摘要+路径） | `bound({sessionID, toolCallID, output})` | 现有（保持，补 summary） | settle |
| `tool/*.ts`（内置） | bash/read/write/edit/apply-patch/glob/grep/webfetch/websearch/todowrite/question/skill | 契约化执行 | 现有（保持，删 opencode 侧 v1 副本） | registry |

**执行模型**（明确两个并存形态）：
- **在线 eager**（主路径）：流式事件到达即 settle，mutation-queue 排序——已接入
- **批收集**（子代理/批量）：收集全批 → scheduler 冲突图分组 → 并行执行——P1 接线

### 1.3 C6 目标域（planning）

| 模块 | 职责 | 关键接口 | 迁移来源 | 接线 |
|---|---|---|---|---|
| `planning/plan.ts` | 计划树（节点状态机/依赖/漂移） | `PlanNode{goal, acceptanceCriteria, dependsOn, status}` / `detectDrift(path, plan, scoped)` | `v2/planning/plan.ts` 提升 | runner goal 模式（P2） |
| `planning/goal.ts` | goal 状态机（注入/续推/声明 complete|blocked） | `goalSystem(session): {inject, shouldContinue, markBlocked}` | runner/llm.ts 内联提取 | runner |
| `planning/drift.ts` | 计划外写检测 + 分级 | `classify(path, plan): minor\|moderate\|severe` | plan.ts 提取 | runner settle 后 |

### 1.4 C7 记忆域（memory）

| 模块 | 职责 | 关键接口 | 迁移来源 | 接线 |
|---|---|---|---|---|
| `memory/store.ts` | wire 事件溯源存储 | `openMemory/replayWire/appendWire` | `v2/memory/store.ts` 提升（已接线） | 全仓 |
| `memory/sediment.ts` | 失败/偏好自动沉淀（去重） | `recordPending(store, signal)` | `v2/memory/sediment.ts` 提升（已接线） | runner autoVerify |
| `memory/search.ts` | CJK 双字 TF-IDF 检索 | `search(store, query): topK` | `v2/memory/search.ts` 提升 | builtin 检索式注入（P2） |
| `memory/search-index.ts` | 锁即选举全文索引 | `ensureIndex(store)/query(index, term)` | `v2/memory/search-index.ts` 提升 | search |
| `memory/append-index.ts` | 无锁 append-only 索引 + tombstone | `append/scan` | `v2/memory/append-index.ts` 提升 | store |
| `memory/blob-store.ts` | 大内容 offload | `put(blob): ref` | `v2/memory/blob-store.ts` 提升 | store |
| `memory/context.ts`（V1） | **删除**（JSON 文件版） | — | 删 | builtin 改读 wire |

### 1.5 C8 学习域（skills）

| 模块 | 职责 | 关键接口 | 迁移来源 | 接线 |
|---|---|---|---|---|
| `skills/skill.ts` | 技能定义/优先级/匹配 | `Skill{params, steps, verify, sources}` | `v2/skills/skill.ts` 提升 | skill 工具 |
| `skills/learn.ts` | 工作流签名聚合 → 候选技能 | `evidenceFromTurns(turns): candidates` | `v2/skills/learn.ts` 提升 | runner step 边界（P3） |
| `skills/skill-store.ts` | wire 持久化 + 确认流 | `recordCandidate/confirm/reject` | `v2/skills/skill-store.ts` 提升 | learn |

### 1.6 C9 验证域（verify）

| 模块 | 职责 | 关键接口 | 迁移来源 | 接线 |
|---|---|---|---|---|
| `verify/verifier.ts` | 验证器注册/失败语义化 | `Verifier{command, triggers, parse}` / `DEFAULT_VERIFIERS` | `v2/verify/verifier.ts` 提升（已接线） | runner autoVerify |
| `verify/trigger.ts` | glob 匹配触发 + 并行执行 | `matchingVerifiers/runVerifiers/renderReports` | `v2/verify/trigger.ts` 提升（已接线） | runner |
| `verify/baseline.ts` | 回归基线（known-fail 白名单） | `verify.known` 命令面 | 新增（M9 §9.4） | P3 |

### 1.7 C10 自省域（introspection）

| 模块 | 职责 | 关键接口 | 迁移来源 | 接线 |
|---|---|---|---|---|
| `introspection/attribution.ts` | 决策快照采样 + 归因四分类 | `sample(turn)/attribute(failure): Attribution` | `v2/introspection/attribution.ts` 提升 | runner（失败轮必存）+ 命令面 |
| `introspection/loop.ts` | 元认知闭环（归因→教训→技能） | `closeLoop(attribution): lessons` | `v2/introspection/loop.ts` 提升 | P3 |

### 1.8 C11 治理域（governance）

| 模块 | 职责 | 关键接口 | 迁移来源 | 接线 |
|---|---|---|---|---|
| `governance/ledger.ts` | 成本账本（任务→会话→项目三级） | `record(usage)/total/byModel/alerts` | `v2/governance/ledger.ts` 提升 | runner step 边界（P2 接线） |
| `governance/policy.ts` | 模型路由策略 + 预算闸门 | `ModelPolicy{main, subagent, fallback, costBudget}` | `v2/governance/policy.ts` 提升 | runner model 解析 |
| `governance/failover.ts` | provider 容灾链 + 事件 | `failover(primary, fallback[]): events` | policy 提取 | P3 |

### 1.9 C12 信任域（security）

| 模块 | 职责 | 关键接口 | 迁移来源 | 接线 |
|---|---|---|---|---|
| `security/isolation.ts` | 角色隔离 + 注入检测 + 脱敏 | `sanitize(content): Content{role, trust, suspectedInjection}` | `v2/security/isolation.ts` 提升 | **projection 管道（P1 接线）** |
| `permission/index.ts` | PermissionV2（策略链） | `assert/ask/configured` | 现有（保持） | 工具执行 |
| `permission/arity.ts` | BashArity 前缀审批 | `prefix(tokens)` | 现有（保持） | bash |
| `permission/saved.ts` | 项目级批准持久化 | `savedRules()` | 现有（保持） | assert |

### 1.10 C13 事件域（events）

| 模块 | 职责 | 关键接口 | 迁移来源 | 接线 |
|---|---|---|---|---|
| `events/bus.ts` | EventV2 总线（持久化/定序/pubsub/replay） | `publish/subscribe/replay(seq)` | `bus.ts`（更名收敛，分文件） | 全仓 |
| `events/persistence.ts` | 版本化持久化 + 事务定序 | `append(events): seq` | bus.ts 提取 | bus |
| `events/replay.ts` | 游标分页重放 | `replay(after: seq, limit)` | bus.ts 提取 | server/handlers/event |
| `events/lifecycle.ts` | 工具生命周期事件 + 心跳 | `tracker(): {started/completed/failed}` | `v2/events/lifecycle.ts` 提升 | runner/settle |

### 1.11 C14 委派域（delegation）

| 模块 | 职责 | 关键接口 | 迁移来源 | 接线 |
|---|---|---|---|---|
| `delegation/subagent.ts` | 子代理协议（父只看最后一条 + resume） | `delegate(task, profile): SubagentResult` | `v2/execution/subagent.ts` + `subagent/runner.ts` 融合 | agent 工具 |
| `delegation/parallel.ts` | 并行组（fan-out/fan-in + 冲突预检） | `ParallelGroup{tasks, results}` | `v2/execution/parallel.ts` 提升 | delegate |
| `delegation/swarm.ts` | 限流感知调度 | `schedule(initial=5, backoff)` | `v2/execution/swarm.ts` 提升 | parallel |
| `delegation/limiter.ts` | 子代理并发/深度上限 | `acquire()/release()` | `subagent/limiter.ts` 保持 | delegate |

### 1.12 C3 世界域（world）

| 模块 | 职责 | 关键接口 | 迁移来源 | 接线 |
|---|---|---|---|---|
| `world/snapshot.ts` | 环境快照（git 并行探测/脱敏） | `capture(): EnvSnapshot` | `v2/world/snapshot.ts` 提升 | projection L1（P3） |
| `world/probe.ts` | 探查原语（peek/symbols/imports/head） | `probe(kind, target): tokens-bounded` | `v2/world/probe.ts` 提升 | 工具注册（P3） |
| `world/file-index.ts` | 文件树索引（增量维护） | `FileIndex{tree, entries, generation}` | `v2/world/file-index.ts` 提升 | world |
| `world/debounce.ts` | 事件去抖批量 | `debounce(events, 500ms): batch` | `v2/world/debounce.ts` 提升 | C13 发布前 |

---

## 2. llm 神经接口 — 深度设计

**模块表**：

| 模块 | 职责 | 关键接口 | 动作 |
|---|---|---|---|
| `schema/events.ts` | LLMEvent 16 态 + Usage 分解 | `Usage{inputTokens, outputTokens, cacheRead, cacheWrite, reasoning}` | 保持；补 schema 包换算组合子 |
| `route/client.ts` | Route 四轴编译/执行 | `Route.make({id, provider, protocol, endpoint, auth, framing\|transport})` | 保持 |
| `route/executor.ts` | 重试/退避/脱敏/限流 | `RequestExecutor` | 保持 |
| `protocols/openai-responses.ts` | Responses 协议（1025 行） | 拆：messages/audio/streaming/hosted-tools | P2 拆分 |
| `protocols/anthropic-messages.ts` | Messages 协议（855 行） | 拆：messages/tools/streaming | P2 拆分 |
| `providers/*.ts` | 配置化门面 | `configure({apiKey}).model(id)` | dead 门面标注（唯一真相=opencode import 列表） |
| `llm.ts/tool.ts/tool-runtime.ts` | 请求构造/类型化工具 | `LLM.request/updateRequest/generateObject` | 保持 |

**关键设计**：`exactly one llm.stream per provider turn` 是 core runner 的唯一兑现点；`LLMEvent.is.*` 守卫是消费方唯一事件词汇；executor 的脱敏是敏感信息保护的最后防线（C12 配合）。

---

## 3. schema/protocol — 深度设计

**schema 新增契约**（C3–C14 能力的词汇登记，P0–P2 随域落地）：

| 新契约 | 内容 | 消费方 |
|---|---|---|
| `plan.ts` | `PlanNode{id, goal, acceptanceCriteria, dependsOn, status, budget, spent}` | planning 域 + tui plan 视图 |
| `memory-entry.ts` | `MemoryEntry{id, category, title, content, status, supersedes}` | memory 域 + tui 记忆视图 |
| `verify-report.ts` | `VerificationResult{verifier, passed, failures[]}` | verify 域 + tui 徽标 |
| `usage-ledger.ts` | `UsageLedger{byTask, sessionTotal, byModel}` | governance 域 + stats |
| `locale.ts` | `Locale = "en" \| "zh"` | builtins 语言偏好 |
| `TokenCounts` 组合子 | tokens 账本（消除 4 处重复） | session-event/message/info 复用 |

**protocol 新契约**（命令面，P2–P3）：`plan.get`、`memory.list/confirm`、`verify.run/known`、`usage.current`、`locale.get/set`。

---

## 4. server 感官通路 — 深度设计

**模块表**：

| 模块 | 职责 | 动作 |
|---|---|---|
| `handlers/session.ts`（613 行） | 22 端点 | 拆 session-crud/input/event/history 四文件；`mapSessionNotFound` helper 抽公共 |
| `handlers/message.ts` | 历史分页 | cursor 收敛到共享模块（与 session.ts 共用一处） |
| `handlers/pty.ts` | PTY + WebSocket | 保持（dropping queue 加固已有） |
| `handlers/event.ts` | 全局 SSE | 保持（EventV2 过滤到 ServerDefinitions） |
| `auth.ts/cors.ts` | fork 加固 | 保持（timingSafeEqual/CORS 收紧） |

---

## 5. tui 呈现 — 深度设计

**单存储收敛设计**（P1）：
```
当前：SSE → data(store V2) → v2-bridge reconcile → sync(store V1) → 渲染
目标：SSE → data(store V2) → toRenderShape 纯转换 → 渲染
```
- `context/data.tsx` 保持（V2 游标消费，已就位）
- `context/sync.tsx` 职责收窄：只处理权限/提问/todo 状态（非消息），消息渲染全部走 data
- `v2-bridge.tsx` 删除（转换内联为 `util/to-render-shape.ts` 纯函数）
- `v2-convert.ts` 保留为渲染适配（消息 V2 → 渲染原语）

**组件拆分清单**（P2）：
- `routes/session/index.tsx`（2789）→ `routes/session/{index,message-list,input-area,tool-display,plan-view,cost-panel}.tsx`
- `component/prompt/index.tsx`（1571）→ `{index,input,autocomplete,history,stash}.tsx`
- `theme/index.ts`（1118）→ `{tokens,generator,highlight}.ts`
- `feature-plugins/system/diff-viewer.tsx`（1095）→ `{diff,stage,apply}.tsx`

**新增呈现能力**（P2–P3）：plan 树视图（C6）、验证结果徽标（C9）、成本面板（C11）、记忆/教训浏览（C7）。

---

## 6. opencode 身体 — 深度设计

**删除清单**（P1，按依赖顺序）：

| 步骤 | 删除 | 替代 |
|---|---|---|
| 1 | `src/tool/registry.ts` + `src/tool/*`（AI SDK 工具集） | core tool 域；TUI/CLI 改消费 |
| 2 | `src/session/llm/ai-sdk.ts` | native-runtime 唯一 |
| 3 | `src/session/processor.ts`（718） | runner 承担 |
| 4 | `src/session/prompt.ts` 的 loop（>1000 行） | SessionV2 + SessionExecution |
| 5 | `src/session/prompt/*.txt`（14 模板） | core system-context 模板 |
| 6 | `src/session/message-v2.ts`、`permission/evaluate.ts`、`server/projectors.ts`、`session/reminders.ts` | core 投影 |
| 7 | `src/mcp/v2-source.ts`（已删）→ McpV2 重设计为 location 节点 | 待定 |

**组装收敛**：AppLayer 节点 46 → ~30（v1 服务删除后）；V2 领域（SessionV2/EventV2/Projector/Execution/ToolRegistry/SystemContext）单点组装；server.ts 不再叠第二层。

---

## 7. plugin 扩展接口 — 深度设计

**三节律 API 定稿**（P2）：

```ts
// 类型化 hook 返回（Claude Code 决策协议 Effect 化）
type HookResult =
  | { kind: "continue" }
  | { kind: "block"; feedback: string }        // 回喂大脑
  | { kind: "decision"; action: "allow" | "deny" | "ask" }
  | { kind: "rewrite"; input?: unknown; output?: unknown }

interface PluginContext {
  tools: { register(def, execute): void; hook(phase: "before" | "after", cb): void }  // 已有
  events: { subscribe<Type>(type): Stream<EventMap[Type]> }                            // 已有
  agents: { register(def): void; transform(editor): void }
  skills: { register(def): void }
  commands: { register(def): void }
  references: { register(def): void }
  integrations: { register(def): void }
}
```

**动作**：promise 侧补齐 event/tool 或声明 deprecated；写 `example-v2.ts`（注册工具 + hook + 事件订阅）+ 类型测试。

---

## 8. sdk 语言翻译 — 深度设计

- `v2/server.ts` 与 `server.ts` 合并：`server.ts` 保持实现，`v2/server.ts` re-export（P0）
- `client.ts` 与 `v2/client.ts` 共享 rewrite/error 辅助（P0）
- v1 gen 冻结标注 + sdk-v1-smoke 迁移清单（P2 删）
- build.ts 3 处 patch 上游化（跟随 @hey-api 升级）

---

## 9. 工具/介质包

- **codemode**：`openapi/` 移出公共面（`exports` 去掉 openapi 子路径）+ 标注实验性（P0）；interpreter 不拆
- **http-recorder**：`socket.ts` 标 deprecated（P0），保留 `makeWebSocketExecutor`（llm 用）
- **effect-drizzle-sqlite**：不重构，等上游替换（持续对拍 RC 声明）

---

## 10. 包间结合架构 — 逐组件链路设计

### 10.1 一轮 turn（P1 目标态）

```
① tui 输入 → opencode cli/cmd/run（身体）→ SessionV2.prompt（core session.ts）
② session.ts: admit（durable inbox）+ publish Prompted
③ execution/local: resume → coordinator → SessionRunner.run
④ runner/llm.ts runTurnAttempt:
   a. getSession + agents.select + SessionContextEpoch.initialize
   b. SessionHistory.entriesForRunner（基线后历史）
   c. projection.project（六层：system-context.combine + instruction + memory builtin + history + live）
   d. isolation.sanitize（数据角色标注）
   e. governance.policy（模型解析）+ budget.allot
   f. llm.request → llm C1（LLMClient.stream，唯一 provider turn）
   g. LLMEvent → publisher（durable 发布：text/tool/reasoning/step）
   h. tool call → mutation-queue.run(accessOfCall) → registry.settle（权限→执行→有界）
   i. step 结束：autoVerify（写路径→验证器→Synthetic 注入）+ sediment（失败→pending）+ ledger（usage 落库）
⑤ runner 循环：goal.shouldContinue（写后即停→续推≤3）/ steer / queue
⑥ tui: data.tsx 游标 SSE 实时呈现
```

### 10.2 记忆闭环（P1 已就位）

```
C9 verify 失败 → C7 sediment.recordPending（wire append，标题去重）
  → 用户确认（tui 记忆视图，P2）或复用3次 → confirmed
  → C4 builtin 注入（core/v2-memory source，≤10 条×240 字符）
  → 下一会话基线携带 → 不再犯同类错
```

### 10.3 成本闭环（P2 接线）

```
llm C1 usage（finish 事件）→ C11 ledger.record（step 累计）
  → session 行落库（tokens/cost 列）→ stats 命令 / tui 成本面板
  → budget 闸门：alertAt（告知剩余）→ hardStopAt（强制收尾+摘要）→ 可解除
  → policy 建议（失败率高→升级模型；机械任务→降级）
```

---

## 11. 性能/成本/算法细化

| 域 | 细化约束 |
|---|---|
| C4 | projection 纯函数（同输入同输出）；预算查表 O(1)；估算记忆化 WeakMap；估算优先序（usage 时间戳守卫）；压缩同步阻塞（一致性优先） |
| C5 | 冲突图 O(n²) n≤8；per-file 队列 O(1) 摊销；截断 O(n) 单趟；spill 仅大输出；缓存键含 mtime 自动失效 |
| C7 | 追加写 O(1) + fsync；索引重建 O(n log n) 仅崩溃后；检索读盘按词 + LRU；每 2048 文档让出事件循环 |
| C9 | 验证器复用工具执行原语（有界+超时）；mtime 集缓存；快验先跑 |
| C11 | usage 优先记账（批量落库不逐事件 fsync）；路由判定 O(1) |
| C1 | stallTimeout（5min）；重试指数退避 + Retry-After 尊重；usage 时间戳防重复 |
| 启动 | 懒加载命令 + 技能懒扫描 + catalog 快照 + init forkDetach |

---

## 12. 多语言深度设计

### 12.1 模型层（保持英文，零变化）

- prompt 模板/工具描述/schema 描述全部英文——**字节稳定是 prompt cache 命中的硬约束**
- 用户语言由用户消息原文天然携带（不翻译）

### 12.2 语言偏好注入（P2）

```
config: { locale?: "en" | "zh" }          # 默认不注入（最小注入）
builtins: core/locale source：
  load: Effect.succeed(locale ?? "")      # 空=不注入
  baseline: (l) => l ? `Respond in the user's language: ${l}` : ""
```
- 仅一行 system 文本，不改变任何模板；英文用户零影响

### 12.3 TUI 界面 i18n（P2）

```
tui/src/i18n/
├── index.tsx      # I18nProvider（locale context + t() 函数）
├── zh.ts          # 中文字典
└── en.ts          # 英文字典（默认）
```
- 组件文案抽 `t("key")`，键盘/命令/主题不翻译
- 优先级：菜单/按钮/对话框 → 提示/状态栏 → 错误信息（错误保留英文+可追溯）

### 12.4 记忆沉淀语言（P2）

- sediment 教训模板按 locale 参数化（`recordPending(store, signal, locale?)`）
- 注入不改（内容原样）；搜索不分语言（CJK 双字分词已覆盖中英）

### 12.5 不做的事

模型层翻译、代码/注释翻译、schema 文案 i18n、领域词汇双语。

---

## 13. 任务级路线图

### P0（清理与死岛裁决，~1 周）
- [ ] P0.1 core：删 v2 复制品（compaction/context-levels/system-context/registry/bus/registry 6 处）+ 死代码（orchestrator/provider/fs-tools/run-tools/application-tools/tool/cache/select-tools/shared）
- [ ] P0.2 core：提升 scheduler/projection/budget/algorithms/isolation → 目标域（搬代码不改签名，测试随迁）
- [ ] P0.3 删空壳（projectors.ts/evaluate.ts/reminders.ts）；codemode openapi 移出公共面；http-recorder socket 标 deprecated
- [ ] P0.4 sdk v1/v2 server.ts 合并
- [ ] 验收：`core/v2` 零引用；全量测试绿（core 1173+ 基线）

### P1（单栈收敛，~2 周）
- [ ] P1.1 opencode 删 v1 工具表/工具实现 → TUI/CLI 切 core 工具（TUI 无感切换）
- [ ] P1.2 opencode 删 processor/ai-sdk → native 唯一
- [ ] P1.3 opencode 删 prompt.loop → run/tui 走 SessionV2（灰度开关）
- [ ] P1.4 runner 接线 projection/isolation（buildRequest 升级）
- [ ] P1.5 TUI 单存储收敛（sync 收窄 + v2-bridge 删）
- [ ] 验收：TUI 全功能回归；httpapi 全绿；sync 冲突面下降

### P2（包内架构稳定，~2 周）
- [ ] P2.1 core 拆分（runner 7 文件/git 目录/session 目录/bus 分文件）
- [ ] P2.2 opencode 拆分（provider/transform/lsp/mcp/prompt）
- [ ] P2.3 tui 拆分（7 单体）+ 新增 plan/verify/cost 视图
- [ ] P2.4 server 拆分 + cursor 收敛；protocol 双端点合并
- [ ] P2.5 schema V2 前缀清理 + TokenCounts + 新契约登记
- [ ] P2.6 llm 协议拆分 + dead 门面标注 + DESIGN 移出
- [ ] P2.7 plugin 三节律定稿 + 示例 + 类型测试
- [ ] P2.8 多语言：i18n 字典 + locale 注入 + sediment 参数化
- [ ] 验收：无 >700 行领域文件；插件示例可跑；zh/en 双语言可用

### P3（能力深化，~2 周）
- [ ] P3.1 compaction 管道化 + todo 锚定（pi）
- [ ] P3.2 goal 状态机 + 计划树 + drift（kimi）；tui plan 视图
- [ ] P3.3 子代理三件套（coder/explore/plan）
- [ ] P3.4 工具 ACI 审计（强制绝对路径/失败分类/retryHint）
- [ ] P3.5 记忆检索式注入（L3 top-K）
- [ ] P3.6 自省接线（决策快照/归因）+ 复盘命令
- [ ] 验收：真实任务基准对比 P0（单轮正确率/轮次效率/成本）

---

## 14. 验收指标（每阶段可量化）

| 指标 | P0 基线 | P3 目标 |
|---|---|---|
| 全量测试通过率 | core 1173+（预存 move-session 除外） | 全包绿 |
| >700 行领域文件数 | 32 | 0（受控求值器除外） |
| v2/ 命名空间引用 | 61 文件 | 0 |
| 双轨实现对数 | 6（会话/工具/客户端/prompt/事件/记忆） | 0 |
| 单轮任务轮次（真实修复任务） | 4–8 | ≤4（goal+验证闭环） |
| prompt cache 命中 | 现状 | 稳定 system 排序 + 渐进披露后提升 |
| TUI 启动 | 已修（SessionCommand/Location） | 冷启动 < 2s |
