# opencode-x V2 演进研究报告

> 日期：2026-07-30
> 方法：deep-research workflow（5 搜索角度 → 23 个一手来源 → 109 条声明提取 → 25 条三票对抗验证，23 确认 / 2 证伪）+ 本地 V2 代码与规格审计（specs/v2/ 全文 + core/opencode/plugin/tui 落地核查）
> 状态：研究备忘录（非规格）。集成建议为分析性推演，落地前须按 MERGE.md 对抗审计流程逐项裁决并登记偏离清单。

---

## 0. TL;DR

1. **V2「硬核心」已高质量落地**（事件溯源、Effect-native Runner、Context Epoch、System Context 代数、Tool 代数、Compaction、Permission/Policy、Catalog transforms、Location-scoping），阻塞 launch 的是「软外围」：插件公开 API、V1 运行时上下文对齐表的 missing 行、MCP/子代理进入 V2 路径、以及已挂载的 V2 HTTP 游标 API 尚无消费者。
2. **earendil-works/pi 是架构最近邻、最高价值的研究对象**（不是要合并的第二个上游，而是思想来源）：其 steer/follow-up 投递语义与 V2 的 steer/queue 近乎同构，`transformContext` 可覆写管道正是 V2 compaction 预留缝的成熟范本，pi-tui 的防闪渲染技术直接服务「TUI 一流」准绳。
3. **MoonshotAI/kimi-code 确证不是 opencode fork**（GitHub API `fork:False`，零 opencode 归属），其 TUI 血统来自 pi-tui；PLAN.md 中「参照 Kimi CLI」应更新为 kimi-code，并增列 pi 为主要参照系。
4. **Claude Code 最可迁移的是 hooks 三节律生命周期 + 决策协议**（PreToolUse 参数改写 / PostToolUse 结果改写 → Policy 的执行缝）与 **Markdown+YAML+位置优先级的 agent 定义格式**（可审计，契合「一切偏离必须对抗审计」）。
5. **Anthropic 的「简单可组合模式胜过框架」与「工具 ACI 设计主导可靠性」为「只删不改架构」提供了外部实证背书**；V2 的不透明 Tool.Definition 单执行器方向正确，下一步应投入「难以误用的工具接口」而非 prompt 技巧。

---

## I. 现状基线：V2 落地程度（本地审计）

### 已实现（可独立运行）

| 模块 | 位置 | 备注 |
|---|---|---|
| EventV2 总线 | `core/src/bus.ts`（657 行，经 `event.ts` 重导出） | 版本化持久化、事务定序、pub/sub、replay、replay-owner claim |
| 事件溯源会话输入 | `core/src/session/input.ts`、`projector.ts`、`history.ts` | `session_input` 持久 inbox、`PromptAdmitted`→`Prompted` 投影、steer/queue 双投递语义 |
| Effect-native Runner | `core/src/session/execution/local.ts`、`runner/llm.ts`（472 行） | 进程全局 `SessionExecution.resume` → Location 发现 → 每 provider turn 一次显式 `llm.stream`；**不经过 legacy `SessionPrompt.loop`** |
| Context Epoch | `core/src/session/context-epoch.ts` | 不可变 baseline + 模型隐藏 Snapshot，compaction 换代 |
| System Context 代数 | `core/src/system-context/index.ts`（320 行） | `Source<A>` 存在性擦除、`combine`、`unavailable` 三态（stale-while-revalidate）；全仓最「代数化」模块 |
| 自动 Compaction | `core/src/session/compaction.ts`（283 行） | `DEFAULT_BUFFER=20_000`、`DEFAULT_KEEP_TOKENS=8_000`、固定 Markdown 摘要模板、auto+overflow+manual 三入口 |
| Tool 代数 | `core/src/tool/tool.ts`、`registry.ts` | 不透明 `Tool.Definition`、单执行器、codec 边界、settlement 统一限流；~15 个内置工具 |
| PermissionV2 | `core/src/permission.ts`（310 行） | 有序 Ruleset（allow/deny/ask）、agent 作用域、saved 项目级批准 |
| Policy | `core/src/policy.ts` | action/resource 通配、last-match-wins；仅 `provider.use` 一个消费者 |
| Catalog transforms | `core/src/catalog.ts`（304 行） | Option B：插件注册可重放 transform + finalize + diff + 事件 |
| Location-scoping | `core/src/location-service-map.ts` 等 | V2 依赖注入骨架，无 Session ID 穿透下层 |

### 部分实现 / 仅规格

- **V2 Config**：投影骨架在，`config.md` 的 remove/redesign 字段裁决未全部落 schema；旧配置自动迁移未做。
- **Plugin 公开 API**：`packages/plugin/src/v2/effect|promise` 基本是类型桩 + 一份 515 行 PLAN.md（自称「implementation plan, not documentation for the current API」），9 段迁移计划处于第 1–3 阶段之间。**这是 launch v2 最大的单点未完成项**。
- **Provider 原生适配**：openai/responses、openai/completions、anthropic/messages 已通；Google/Azure/Bedrock/OpenRouter/Copilot/Vertex 列为 future slices。
- **sessions.events / history 端点**：已挂载（protocol + server handlers），**无前端消费者**。
- **明确推迟**：崩溃后续跑恢复、集群执行所有权、provider 超时看门狗、插件定义 Context Source、热重载生命周期（均为有意设计债务）。

### 桥接现状与风险

- 三条单向通道全部 **V1 写、V2 读**：SessionProjector（V1 会话事件→V2 投影表）、Shadow Prompt 镜像（受 `OPENCODE_EXPERIMENTAL_EVENT_SYSTEM` 门控、默认关）、EventV2Bridge（补 Location 路由 + 向 legacy GlobalBus 双发）。
- 读侧已半 V2 化：legacy `GET /session/:id/messages` 走 `MessageV2`（读 V2 投影表），而 prompt/abort/command/shell/revert 全走 V1 `SessionPrompt`（1671 行单体）。
- **风险**：双事件世界（GlobalBus 内存 SSE ∥ EventV2 持久可重放）schema 漂移会让 TUI 与 V2 读模型不一致；规格-代码漂移（provider-model.md vs `catalog.ts`、config.md 11 组裁决）放大合并认知成本；重叠域双份 handler 维护税递增。

### Launch 阻塞项（对齐 todo.md「work towards a launch of v2」）

1. **V1 运行时上下文对齐表 missing 行**：本地/glob/远程指令源与嵌套发现、provider/model 族基线指令、每 prompt 的 system/工具覆盖与 final-step 提醒、插件 message/system/parameter/header 变换、结构化输出策略、原生模板与 `@mention` 展开。
2. **MCP 工具在 V2 路径缺席**（runner 内嵌清单未勾选「MCP, plugin, and structured-output tool definitions」）。
3. **子代理/task 仍回调 V1** `SessionPrompt.loop`；BackgroundJob 与 V2 工具执行未集成。
4. **插件公开 API 未成型**（todo.md「Plugin API design - James?」仍挂问号）。
5. **V2 HTTP 游标 API 无消费者**——事件溯源的客户端价值尚未兑现。

---

## II. 三个项目的高价值部分（对抗验证后）

### 1. anthropics/claude-code（闭源；结论基于官方文档 + 可信逆向，2 条内部细节被证伪）

**已广泛验证：**

- **Hooks 三节律生命周期**（官方文档，3-0 / 2-1 / 3-0）：per-session（SessionStart/SessionEnd）、per-turn（UserPromptSubmit/Stop/StopFailure）、per-tool-call（PreToolUse/PostToolUse）；JSON 事件上下文走 stdin/POST；**刻意非 Unix 的退出码协议**（0=解析 stdout JSON，2=阻塞错误且 stderr 回喂模型，其他=非阻塞）；**PreToolUse 可返回 `permissionDecision` allow/deny/ask 并以 `updatedInput` 改写工具参数，PostToolUse 可以 `updatedToolOutput` 替换模型可见的工具结果**——在「出站输入/入站结果」边界做脱敏与变换。
- **Subagent 定义格式**（官方文档，全 3-0）：Markdown + YAML frontmatter（仅 name+description 必填，正文即 system prompt）；位置优先级 managed settings > `--agents` CLI > `.claude/agents`（项目）> `~/.claude/agents`（用户）> 插件；`tools` 允许清单 / `disallowedTools` 拒绝清单，支持 `mcp__<server>`、`mcp__*` 通配，零解析即拒绝启动；每 subagent `permissionMode`（default/acceptEdits/auto/dontAsk/bypassPermissions/plan，manual 为别名），继承主会话权限上下文但可覆写（父级 bypassPermissions/acceptEdits 优先不可覆盖）。
- **上下文保全双机制**（3-0 / 2-1）：模型自维护的 todo 列表（TodoWrite，对抗「context rot」，明确拒绝「一个模型出 todo、另一个实现」与「多代理交接」方案）+ 隔离上下文子代理（各持独立上下文窗口、只回传结果，官方文档以「Preserve context by keeping exploration and implementation out of your main conversation」领衔）。
- **工具 ACI 设计主导可靠性**（官方，3-0）：Anthropic 做 SWE-bench agent 时优化工具花的时间超过优化 prompt；相对路径失败模式靠「强制绝对路径」的防呆设计根除。
- **拒绝 RAG/向量检索**（可信逆向，3-0）：让模型用 ripgrep/jq/find 支撑的专用 Grep/Glob/Task 工具驱动搜索，prompt 以 IMPORTANT 规则禁止裸 bash grep/find（表面矛盾的答案：专用工具内部 exec ripgrep）。
- **Anthropic 循环架构观**（官方，3-0/2-1）：agent = LLM 动态自主指挥工具使用（对照 workflow = 预定义代码路径）；生产级 agent「就是循环里由环境反馈驱动、调用工具的 LLM」；每步必须从环境取得 ground truth，配 max-iterations 类停止条件；**最成功的实现不用复杂框架，而用简单可组合模式**。

**实验性 / 未证实：** auto-compact 的具体触发阈值与保留算法**未能证实**（仅确认 todo + 子代理隔离是主保全层、存在 PreCompact hook 事件）——这是与 V2 compaction 最相关的空白。

**已证伪（勿引用）：** ①「单主循环 + 非递归自我克隆、最多一层分支」的循环拓扑（1-2 否决）；②「system prompt 约 2,800 token、工具定义约 9,400 token、每 prompt 内嵌完整 CLAUDE.md」的精确数字（0-3 否决）。

### 2. earendil-works/pi（MIT monorepo，~80.6k★，作者 Mario Zechner/badlogic；一手源码核验）

**定位**：「agent harness」工具包，四包分解——`pi-ai`（统一多 provider LLM API）、`pi-agent-core`（agent 运行时）、`pi-coding-agent`（编码 CLI）、`pi-tui`（差分渲染 TUI）。**刻意不内置权限系统**（README 反营销式自认：以启动用户权限运行，强隔离外包给三种容器化模式：Gondolin 微 VM、Docker、OpenShell 沙箱）。

**已广泛验证的高价值设计：**

- **steer/follow-up 双队列投递语义**（README + 源码，3-0/2-1/3-0）：steering 消息**只在当前 turn 的所有工具调用完成之后**注入；follow-up **只在既无剩余工具调用、又无 steering 消息时**检查——即「运行中纠偏」与「运行后补活」的精确边界。
- **上下文管理 = 可覆写管道，而非硬编码算法**：`AgentMessage[] → transformContext() → convertToLlm() → LLM Message[]`，配 `shouldStopAfterTurn`（键控 `shouldCompactBeforeNextTurn`）。pi 自带默认 compaction（`src/harness/compaction` 的 branch-summarization，有 `DEFAULT_COMPACTION_SETTINGS`），但**经由 transformContext 接线、可被 `session_before_compact` hook 整体替换**——循环核心无任何硬编码压缩。
- **工具执行调度**：默认并行；批内**任一**工具标 `executionMode:'sequential'` 则整批串行；`beforeToolCall` 预检（在 `tool_execution_start` 之后、参数解析验证后）可阻断执行。
- **pi-tui 三策略差分渲染**（源码逐行核验，全 3-0）：① 首帧输出全部行、不清 scrollback；② 终端宽度变化或视口上方发生变化 → clear + 全量重绘；③ 否则光标移到首个变化行、clear-to-end、仅重绘变化行。**每帧包裹 CSI `?2026h … ?2026l` 同步输出转义并以单次 `terminal.write()` 原子写出**（防闪核心）。组件模型刻意极简：`render(width): string[]`（每行一个字符串）+ `handleInput`/`invalidate`；**宽度超限直接报错停机**；每行追加完整 `SGR + OSC 8` 复位（`\x1b[0m\x1b]8;;\x07`，有回归测试），样式永不跨行泄漏。

### 3. MoonshotAI/kimi-code（~5.7k★，2026-05-22 创建，活跃）

**血统裁决（已验证，全 3-0）**：**不是 opencode fork**——GitHub API `fork:False / parent:None / source:None`，README/package.json/CONTRIBUTING/LICENSE 对 opencode/anomalyco 零归属，独立 MIT（Copyright 2026 Moonshot AI）。唯一致谢的上游是 **earendil-works 的 pi-tui**（vendor 为 `@moonshot-ai/pi-tui v0.80.8`）。它是 **kimi-cli 的官方继任者**（kimi-cli 收缩中，自动迁移配置与会话）。内置三个隔离上下文子代理：**coder / explore / plan**（「Dispatch built-in coder, explore, and plan subagents in isolated contexts while keeping the main conversation clean」）。

**含义**：要研究 Kimi 的终端 agent 思想，应直接研究 pi；kimi-code 的 coder/explore/plan 三件套是「最小内置子代理集」的具体范本。

### 附：调研中的上游事实（与本 fork 直接相关）

- **上游 opencode 已有 build/plan 双内置 agent**（Tab 切换；plan 默认只读、拒文件编辑、bash 需确认）——plan-mode 与 per-mode 权限默认值**并非 Claude Code 独有**，V2 对齐表里不必当新特性引入。
- **OpenTUI 是 Zig 写的原生核心 + TS 绑定**——opencode-x 的 TUI 基底是原生核，不能像 pi-tui 那样自由重构渲染模型（约束「只删不改」下的 TUI 吸纳必须走增量技术移植，而非换渲染器）。

---

## III. 交叉集成图谱：外部设计 × 本地接缝

按接缝质量（现有抽象是否天然为此设计）排序。每项标注：外部来源 → 本地落点 → 动作 → 约束相容性。

### ★ 1. Compaction 管道化（pi `transformContext` × `core/src/session/compaction.ts`）

- **现状**：compaction.ts 是「单一固定 Markdown 模板 + keep-tokens 滑窗」的朴素实现；规格已预留全部契约（started/ended 持久事件、checkpoint→Context Epoch 换代），且明列两个待办：「provider-aware context control for provider-executed tool results」与「Deterministic old tool-result pruning」。
- **吸纳**：把 compaction 重构为「默认提供、整体可替换」的 Effect 管道（消息序列 → 保留决策 → 摘要 → checkpoint），默认实现保留现有模板；研究 pi 的 branch-summarization（`src/harness/compaction` + `DEFAULT_COMPACTION_SETTINGS`）作为更优默认；并把 Claude Code 的实证结论编入保留策略——**摘要必须锚定模型自维护的 todo 状态**（对抗 context rot；V2 已有 todowrite 工具）。
- **相容性**：不动任何对外契约，纯内部深化；大概率与上游相容，甚至可回馈上游。

### ★ 2. Hook 决策协议（Claude Code hooks × `packages/plugin/src/v2` + Policy）

- **现状**：插件公开 API 是 launch 最大单点缺口；PLAN.md 已把 transform（重放建态）与 runtime hook（活体拦截）二分；`core/src/aisdk.ts` 的 sdk/language hook 证明运行时模式可行。Policy 求值器泛化但只有 `provider.use` 一个消费者。
- **吸纳**：定稿插件公开 API 时采用**三节律生命周期**（session / turn / tool-call）作为骨架；把 Claude Code 的退出码/JSON 协议 Effect 化为**类型化 hook 返回值**（continue / block(feedback) / decision(allow|deny|ask) / rewrite(input|output)）；**PreToolUse 参数改写 + PostToolUse 结果改写正是 Policy 的具体执行缝**（执行前 deny/脱敏、执行后净化），让 Policy 从「provider 准入」泛化到「工具调用治理」，而无需新架构。
- **裁剪判断**：Claude Code 的 shell 命令 / HTTP 端点 hook 载体偏企业化；个人 fork 只需内部 Effect hook 层，外部 shell hook 可按「个人 agent 无用」准则不引入。
- **相容性**：落在上游自己的插件 API 设计轨道上（todo.md「Plugin API design」），属「跟上游一起设计」而非偏离。

### ★ 3. Agent 定义格式 + 内置子代理三件套（Claude Code/Kimi × AgentV2）

- **现状**：AgentV2 容器已实现（transform + select，默认 build）；但 agent system prompt 只是拼进 system 数组；V2 task/subagent「mostly done」而 V1 task 工具仍回调 `SessionPrompt.loop`。
- **吸纳**：AgentV2 定义对齐 **Markdown + YAML frontmatter + 位置优先级**（项目 `.opencode/agent` > 用户全局 > 内置；与 Claude Code 的 managed>CLI>project>user>plugin 同构）——人类可审计，天然契合「一切偏离必须对抗审计」；`tools` 允许/拒绝通配映射到 Policy 的 action/resource 通配 + last-match-wins。**V2 task 工具迁移时，以 kimi-code 的 coder/explore/plan 三件套为最小内置集目标**（explore 只读搜索、plan 只读规划、coder 全权实现——与上游 build/plan 双 agent 相容并更细）。
- **相容性**：上游已有 agent 定义机制，格式对齐是低风险打磨；三件套是增量内置定义，不碰架构。

### 4. TUI 防闪与健壮性技术（pi-tui × opentui/Solid 栈）

- **约束前提**：opentui 是 Zig 原生核，**不换渲染模型**（否则违反只删不改）；pi-tui 的 `render(width):string[]` 与 opentui 的响应式渲染模型冲突度未验证（本研究 open question），故只移植**与渲染模型正交的技术**：
  - **CSI `?2026` 同步输出**：审计 opentui 是否已包裹每帧；未包裹则是小补丁级的防闪大收益（前提：终端支持 mode 2026，不支持者忽略）。
  - **逐行 SGR+OSC 8 复位**：审计 markdown/代码块渲染器是否有样式跨行泄漏；pi 有回归测试可参照。
  - **宽度超限即失败**：作为 TUI 测试/lint 门禁（对标 pi 的硬约束），替代「静默截断」。
  - **三策略差分**：作为测量基准——用 pi 的策略矩阵审计 opentui 自身 diff 算法在「流式 Markdown / 视口上方变化 / 宽度变化」三场景的行为，找补帧而非重写。
- **TUI 最高杠杆升级（本地审计结论）**：`context/sync.tsx`/`context/event.ts` 从 legacy GlobalBus 升级到消费 EventV2Bridge 已在发的 **带 `seq`/`aggregateID` 的 syncEvent**，获得断线后按游标补放能力——不改渲染层，同时为 V2 HTTP 游标 API 造就第一个真实消费者（一举消化两个 launch 阻塞项）。

### 5. steer/queue 语义对照（pi-agent-core × `core/src/session/input.ts` + run-coordinator）

- **现状**：V2 已实现「steer 在当前 drain 需要续跑时于下一个安全 provider-turn 边界提升；queue 输入 FIFO 直到会话将闲、每次提升一个」。pi 的规则是「steering 在当前 turn 全部工具完成后注入；follow-up 仅在无工具且无 steering 时检查」。
- **动作**：**不引入代码，引入测试 oracle**——把 pi 的精确边界语义写成 V2 投递语义的对抗测试用例集（工具批中途 steer、steer+queue 混合、idle 边界提升次序），验证同构或记录分歧。若分歧涉及上游已定义行为，以上游为准（跟踪优先于借鉴）。

### 6. 思想层背书（不入代码，入准绳）

- **Anthropic 循环观 → AgentV2 北极星**：Effect-TS 负责确定性「workflow 外壳」（Catalog/AgentV2 容器、事件投影、Policy 求值、工具派发），**循环内的工具选择权完全留给模型**。这给「Effect 化编排到哪里为止、模型自主从哪里开始」提供了原则性答案，也是对 V2 服务容器「勿过度抽象」的外部警示。
- **工具 ACI > prompt → Tool.Definition 深化**：V2 的 codec 边界已提供防呆基础；下一步逐工具审计「难以误用性」（强制绝对路径——核验 read/write/edit/grep/glob/bash 是否全部强制；参数 Schema 收紧），投入放在工具接口而非 system prompt 技巧。拒绝 RAG/向量库——与「只删不改」完全一致，登记为「已审计不做的事」。
- **pi「沙箱在边界、不在循环内」→ 权限审计备忘录**：对 V2 PermissionV2/Policy 发起一次对抗审计提问——「对个人 agent 是否过度设计？」建议裁决：**保留**（交互终端场景、已实现、维护成本低、是 Claude Code 级体验的一部分），但**明确不向企业方向延伸**（组织托管策略维持纸面；外部容器化仅作为未来可选方向备注）。

---

## IV. V2 演进路线图

> 准则复核：P1/P2 全部落在现有预留缝（compaction 契约、PluginV2.HookSpec、Policy 求值器、AgentV2 容器、EventV2 syncEvent），**不新增架构层**；凡「保留 fork」或「融合」的采纳，按 MERGE.md 登记偏离清单；大概率上游相容的项（compaction 管道化、hook 协议）优先考虑与上游同步或回馈。

### P0 — Launch 前置（消化 todo.md 阻塞项，外部研究只提供设计参照）

1. 插件公开 API 定稿（参照 Claude Code 三节律 + 决策协议；见 III-2）。
2. V1 运行时上下文对齐表 missing 行清零（指令源与嵌套发现、族基线指令、每 prompt 覆盖、final-step 提醒、结构化输出、`@mention` 展开）。
3. MCP 工具与子代理进入 V2 路径（V1 task 工具去 `SessionPrompt.loop` 依赖；内置 coder/explore/plan 三件套为目标形态）。
4. TUI 接入 V2 游标 API（syncEvent seq 补放 → 第一个真实消费者）。

### P1 — 高价值集成（约束相容、接缝就绪）

5. Compaction 管道化 + todo 锚定保留策略 + pi branch-summarization 研究（III-1）。
6. Hook 决策协议落地为 Policy 执行缝（PreToolUse/PostToolUse 改写；III-2）。
7. AgentV2 定义格式对齐（Markdown+frontmatter+位置优先级+工具通配；III-3）。
8. steer/queue 对抗测试集（pi 语义 oracle；III-5）。

### P2 — TUI 一流打磨（增量技术移植，不动渲染模型）

9. opentui 同步输出 / 逐行复位 / 宽度门禁审计（III-4）。
10. V2 新工具（apply_patch、skill）专属渲染器 + feature-plugins 扩展。
11. kv 本地持久化细节（frecency、stash 恢复）。

### P3 — 研究/观察（不一定采纳）

12. Claude Code auto-compact 算法持续侦测（本次未能证实；关注官方文档与 PreCompact 语义）。
13. pi 作为第二参照系的跟踪成本评估（只借鉴思想、不合并代码；避免双上游跟踪负担）。
14. 「权限在循环内 vs 沙箱在边界」审计备忘录（III-6）。

---

## V. 文档同步建议（活文档准则）

- **PLAN.md**：「参照 Claude Code / Qoder / Kimi CLI」→ 更新为 **kimi-code**（kimi-cli 已收缩为其继任者）并**增列 earendil-works/pi 为主要参照系**；「已审计不做的事」增补：RAG/向量检索代码检索（依据：Claude Code 实证 + 只删不改）；可选增补 Rust napi 矩阵旁注「pi 亦以纯 TS 四包达成一流 TUI」。
- **MERGE.md**：本报告 III 中任何落地项按偏离清单格式登记；provider-model.md/config.md 与实现的漂移纳入 hot-zone 同步审计清单（`4ac301401d` 机制）。
- **specs/v2/**：compaction 管道化若立项，在 session.md §Automatic Compaction 补「可替换管道 + 默认实现」契约段（先规格后代码，保持规格-代码一致，避免本研究 §I 所列漂移风险）。

---

## VI. 研究局限与证伪清单

**来源质量**：Claude Code 闭源，其内部结论依赖官方文档（hooks/sub-agents/building-effective-agents，最强）与 minusx.ai 逆向博客（可信但二手）。验证期 WebSearch 部分故障，核验改以一手文档/仓库直接抓取为准，第三方交叉有限。

**已证伪（2 条，勿进入任何文档）**：
1. 「Claude Code 单主循环 + 非递归自我克隆、最多一层分支」（1-2）。
2. 「system prompt ~2,800 token / 工具定义 ~9,400 token / 每 prompt 内嵌完整 CLAUDE.md」（0-3）。

**分析性免责**：所有「映射到 V2 Policy/steer-queue/Context Epoch」的集成建议是基于项目简报的推演，**未在 opencode-x 代码中实测**；落地前逐项对抗审计。

**主要来源**：anthropic.com/research/building-effective-agents · code.claude.com/docs/en/{hooks,sub-agents} · github.com/earendil-works/pi（+ packages/agent、packages/tui 源码） · github.com/MoonshotAI/kimi-code（+ GOAL.md） · minusx.ai/blog/decoding-claude-code · github.com/anomalyco/opencode（specs/v2, packages/plugin）· github.com/sst/opentui
