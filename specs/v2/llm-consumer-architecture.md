# V2 支撑架构体系 — LLM 消费方视角的架构宪法

> **文档地位**：这是 opencode-x V2 的**最高层架构文档**，定义了 V2 所有模块为什么存在、边界在哪、接口长什么样。它从「LLM 是核心消费方」的第一性原理推导，不向后兼容任何 V1 设计妥协。
>
> **阅读对象**：任何实现/修改 V2 模块的人。动手前先确认你的模块在此文档中的位置、分层、契约。
>
> **配套文档**：`specs/v2/session.md`（Session API 细节）、`specs/v2/tools.md`（工具契约细节）、`specs/v2/config.md`、`specs/v2/instructions.md`、`specs/v2/todo.md`（工程队列）。本文件是它们的**母文档**——细节冲突时以本文件的分层与契约优先，冲突必须在相应细节文档登记。
>
> **版本**：v2.0（2026-08-03 初版 M1–M7）→ v2.1（2026-08-03 增补 M8–M12 + 全模块深化）→ v2.2（2026-08-03 全模块补充技术实现规划：数据结构/算法/性能，来源为 pi / kimi-code / 上游 opencode 一手源码研究 + 本 fork 现有实现）→ v2.3（2026-08-03 首批实现落地：`packages/core/src/v2/` 12 模块骨架 + 59 单元测试全绿，链路贯通 M1→M3→M6 编排器验证通过）→ v2.4（2026-08-03 第二轮算法落地：compaction 切点/增量摘要/用户消息白名单、工具契约扩展、路由策略、swarm 限流、记忆自动沉淀，81 测试全绿）→ v2.5（2026-08-03 第三轮：M3 渐进披露 + 结果缓存、M10 技能自动学习、M12→M5→M10 元认知闭环接线，95 测试全绿）→ v2.6（2026-08-03 端到端闭环：真实 provider 适配器 provider.ts 接入 LLMClient.stream（LLMEvent→StreamedEvent 映射 + usage 捕获 + 错误编码进消息）、编排器 runTurnWithProvider（投影→buildRequest→stream→冲突图结算）、98 测试全绿）→ v2.7（2026-08-03 持久化闭环：技能 wire 存储跨会话恢复、无锁 append-only 索引 + tombstone + 路径逃逸守卫、blob offload（引用不存字节）、锁即选举全文索引（fresh 检测/增量锚点/崩溃重建），110 测试全绿）→ v2.8（2026-08-03 端到端冒烟：mock LLM 跑完整任务循环（投影→buildRequest→collectEvents→冲突图并行→生命周期→wire 持久化→技能学习→跨会话恢复），111 测试全绿；修复 LLM finish reason→V2 词表规范化（stop→end / tool-calls→tool_use）；streamTurn 改为结构化 LlmStreamer 接口）→ v2.9（2026-08-03 真实模型验证：DeepSeek 真实 API 跑通全闭环；发现并修复「纯文本回填不足以终止工具循环」——工具结果改为结构化 assistant(tool-call)/tool(result) 消息对回填（toolHistory），真实模型 2 轮正常终止（首轮并行 2 工具调用→次轮直接作答）；buildRequest 支持 toolHistory 消息通道；111 测试全绿 + typecheck 零回归）→ v2.10（2026-08-03 真实文件系统工具层 fs-tools.ts（read/write/search：路径逃逸守卫 resolveInside、64KB 读上限、原子写 temp+rename、tokenize 关键词行搜索）+ 真实修复任务验证（DeepSeek 读→修→验证→报告 4 轮闭环，BUG FIXED）；发现并修复「模型同轮双发相同调用」——dedupeCalls 同轮去重（重复调用共享输出，生命周期/回填只记唯一执行）；111 测试全绿）→ v2.11（2026-08-03 修复→验证→沉淀→复用完整闭环：run-tools.ts（工作区 shell 执行：硬超时/输出 4KB 上限/cwd 钉住，永不抛错）+ 验证器接线（bun test 输出 parseBunTestOutput 语义化失败注入工具回填）+ sediment 新增 Assertion 规则（「verify after every write」教训）+ write 工具最小权限 allowedPrefixes（防测试文件篡改）；真实双任务验证：T1 修复+教训沉淀→wire 持久化→T2 跨会话复用，两任务均 FIXED + ALL PASS；112 测试全绿）→ v2.12（2026-08-03 Goal 驱动 turn 序列：runPlan 编排器接线（M8 §8.6 待接线项落地）——就绪节点→单轮 turn（节点 goal 作 prompt）→外部 verify 验收→节点重试上限→blocked 推进→写路径漂移检测；真实模型验证：3 节点计划（read→fix→verify）3 轮一次通过，completed 全达成 + 零漂移 + FIXED，对比反应式循环（曾 8 轮打转）结构收敛；115 测试全绿）→ v2.13（2026-08-03 V2 接入 CLI：`opencode v2 <prompt>` 命令（instance: false 独立于会话体系）——真实工具 read/write/search/run + 验证器 parse + durable memory 复用（~/.local/share/opencode/v2/<dir hash> wire 重放 confirmed 教训进 memory 层）+ 失败自动沉淀 Assertion 教训 + --json 输出；TurnResult 补 text 字段（模型最终文本）；真实 CLI 冒烟：修 bug→bun test 验证→报告完整闭环；**发现根因**：Effect.promise rejection 是 defect，Effect.catch 只捕获 recoverable errors（此前 EISDIR/ENOENT 硬化修复实际未生效，由模型行为变化掩盖）——fs-tools 全面改 promise 层 .catch 硬化（read/write/search）；122 测试全绿）→ v2.14（2026-08-03 M6 steer 缓冲 + M9 验证器自动触发接线（§14 最后两处「待接线」清零）：runLoop 支持 queuedSteer（idle step 边界按序 flush，kimi steerBuffer 语义）+ deps.autoVerify（写路径 glob 匹配验证器并行执行，报告注入下一轮 history）；trigger.ts（matchingVerifiers 用 Bun.Glob / runVerifiers 并行 / renderReports 区分 FAILED 与环境不可用）；CLI 启用真实 autoVerify；修复 spread 字符串 bug（[...command] 拆成字符）；128 测试全绿）→ v2.15（2026-08-03 M10 技能学习真实闭环：learn.ts 新增 evidenceFromTurns（从编排器 turns 提炼工作流证据）+ renderSkillSteps（技能步骤渲染为 prompt 注入块）；真实双任务验证：T1 无技能 8 轮反复修正 → 提炼技能（read→write→run）→ wire 持久化 + 确认 → T2 技能注入 **4 轮一次收敛**（fixed + allPass）——元认知闭环 M12→M5→M10 全链路真实跑通；130 测试全绿）→ v2.16（2026-08-03 M4 并行组真实验证：双文件独立修复任务（add.ts + multiply.ts），4 轮 = 单文件 4 轮，add+multiply write 同波并行（maxConcurrent=2）；**发现并修复静态访问声明过粗问题**——工具 access path 声明为整个工作区导致所有文件操作相互冲突、冲突图退化为全串行；Scheduler 支持调用级 accessOf（从工具参数推导实际路径），orchestrator TurnInput.accessForCall 透传，CLI 与脚本启用；独立文件 write 并行、同文件 write 串行由动态路径判定；134 测试全绿）→ v2.17（2026-08-03 编排器接入会话运行路径：M3 per-file 串行队列（mutation-queue.ts：同文件写串行/异文件并行/bash 互斥，eager 语义不变）、M9 autoVerify（runner step 边界写路径匹配验证器并行执行，报告发布 durable Synthetic 消息注入下轮投影）、M5 记忆注入（system-context core/v2-memory builtin：confirmed 教训按工作区注入 L3 层）+ 自动沉淀（验证失败 → sediment recordPending，去重：confirmed 永不重写/pending 24h 内跳过）、M8 goal 驱动（session.metadata.goal：system 注入目标 + 写后即停防提前收尾，上限 3 次续推）；`opencode v2` CLI 升级为 durable 会话（共享 AppRuntime Database、yolo 权限、禁 v1 MemoryContext 防初始化阻塞、resume 阻塞至 drain 完成），TUI 列表可见可恢复；Session.Info 增 metadata 字段 + SDK 重新生成；core 1173 测试全绿 + opencode/tui 测试零回归（subprocess/serve 预存失败除外）
>
> **外部来源标注**：本文件各模块的技术实现规划部分引用三个项目的设计（一手源码核验于 2026-08-03）：
> - **pi**（earendil-works/pi，MIT）：agent 运行时/上下文管道/compaction/并行工具执行（`/var/folders/.../v2research/pi` 快照）
> - **kimi-code**（MoonshotAI/kimi-code，MIT）：子代理协议/会话存储/全文索引/权限策略链（同目录 kimi-code 快照）
> - **opencode 上游**（anomalyco/opencode v1.18.11）：本 fork 基线，现有实现即其演化
> - 标注「✅ 采纳」= 已写入本模块技术实现规划；「⚠️ 参考」= 仅作设计参照；「❌ 不采纳」= 有明确理由

---

## 0. 第一性原理：谁是消费方

opencode 是**一个让 LLM（大脑）在终端世界行动的外脑 + 四肢**。所有 V2 模块的存在理由，是服务于 LLM 的工作循环：

```
感知（我看到什么）→ 规划（我决定做什么）→ 行动（调用工具）→ 观察（结果如何）→ 修正 → 记忆
```

### 0.1 大脑的硬约束（架构不可违背的前提）

| 约束 | 含义 | 架构推论 |
|---|---|---|
| 上下文窗口有限 | 注入的每个 token 都是预算 | M1 必须主动管理预算，默认最小注入 |
| 无外部记忆 | 会话结束即失忆 | M5 必须持久化 + 检索式注入 |
| 无实时感知 | 只能通过事件/工具结果了解世界 | M2/M6 必须把世界变成结构化消息 |
| 推理有成本 | 每个 token 都花钱 | M7 必须提供成本可见性与分级路由 |
| 单焦点 | 一次只能深度处理一件事 | M4 必须提供委派，让我保持焦点 |
| 注意力衰减 | 远处上下文影响力下降 | M1 必须分层投影，把当前焦点相关的内容放近处 |
| **注意力与真实世界的时滞** | 我基于快照决策，世界可能在变 | M2 变更事件 + M8 偏差检测必须让我发现「计划≠现实」 |
| **无自我审计能力** | 我看不清自己为什么失败 | M12 必须提供回放与归因 |
| **易被内容操纵** | 我无法天然区分「数据」和「指令」 | M11 必须做内容隔离与信任标注 |

### 0.2 架构的终极目标

**把大脑有限的预算、记忆、注意力，最大化转化为解决问题的能力。**

衡量标准（每条都是可验证的）：
- 单轮正确率（同一任务，给更好的上下文 → 更高首轮正确率）
- 任务轮次效率（完成同样任务，更少的往返）
- 跨会话连续性（新会话能接续旧会话的决策）
- 成本效率（单位解决问题成本）
- **长任务完成率**（≥N 步的任务不失控、不跑偏、不放弃）
- **错误可复盘率**（任何失败都能回放归因）

### 0.3 大脑的四种工作模式（架构必须同时支持）

| 模式 | 场景 | 对架构的侧重 |
|---|---|---|
| **快问快答** | 交互式单轮（「这个函数做什么？」） | M1 最小注入、M3 快工具、低延迟 |
| **深度任务** | agentic loop（「实现这个功能」） | M8 规划、M9 验证、M4 委派、M6 进度 |
| **后台批处理** | headless（CI、夜间任务、无人值守） | M6 进度汇报、M7 预算闸门、M11 无确认下的自治决策 |
| **协作编辑** | 与用户交替修改（pair 模式） | M2 变更感知、冲突检测、M6 用户反馈通道 |

### 0.4 大脑的完整任务生命周期（模块协同总图）

```
1. 接任务        M1 注入 + M2 环境快照 + M8 计划骨架
2. 探查          M2 探查原语（文件树/符号/依赖/快读）
3. 规划          M8 计划树 + 任务栈 + 预算挂接
4. 执行          M3 行动（含并行/重试）+ M4 委派（并行组/子代理）
5. 验证          M9 验证闭环（改完自动跑 typecheck/test/lint）
6. 汇报          M6 进度/完成报告 → 用户
7. 记忆          M5 决策日志/项目知识沉淀
8. 技能          M10 成功模式 → 技能固化（复用）
9. 复盘          M12 失败归因 + 会话报告
     └── 全程：M7 成本账本 + M11 安全隔离 + M2/M6 世界同步
```

### 0.5 模块全景图

```
┌─────────────────────────────────────────────────────────────┐
│                      大脑（LLM 决策循环）                       │
└───┬───────────────────────────┬─────────────────────────────┘
    │ 注入（预算内、分层、相关）    │ 行动（契约化工具调用）
    ▼                           ▼
┌─────────────┐           ┌─────────────┐
│ M1 上下文投影 │           │ M3 工具系统   │
│ (Context)   │           │ (Tools)     │
└──────┬──────┘           └──────┬──────┘
       │                         │
┌──────▼──────┐           ┌──────▼──────┐
│ M8 规划任务栈 │◄────────►│ M4 执行委派  │
│ (Planning)  │  执行循环   │ (Execution) │
└──────┬──────┘           └──────┬──────┘
       │                         │
┌──────▼──────┐           ┌──────▼──────┐
│ M9 验证闭环  │◄────────►│ M6 事件反馈  │
│ (Verify)    │  结果驱动   │ (Events)    │
└──────┬──────┘           └─────────────┘
       │
┌──────▼──────┐
│ M5 记忆层    │◄────────► M10 技能库
│ (Memory)    │   沉淀/复用
└──────┬──────┘
       │
┌──────▼──────┐
│ M2 世界感知  │
│ (World)     │
└─────────────┘
┌─────────────┐  ┌─────────────┐
│ M11 安全信任 │  │ M12 自省审计 │
│ (横切)       │  │ (横切)       │
└──────┬──────┘  └──────┬──────┘
└────────── M7 成本/模型治理（横切）──────────┘
```

**依赖规则**：
- M2（世界感知）是地基——M1 投影的世界状态、M3 工具的结果、M6 事件的源头都来自它
- M3（工具）依赖 M2 的文件系统/进程能力
- M1（投影）依赖 M3 的输出投影规则、M5 的检索结果、M2 的当前状态
- M4（委派）依赖 M1 的子代理上下文构造 + M3 的工具注册 + M6 的结果回收
- M8（规划）依赖 M1 的任务上下文 + M6 的进度事件 + M7 的预算
- M9（验证）依赖 M3 的执行原语 + M2 的文件状态 + M6 的结果发布
- M10（技能）依赖 M5 的历史沉淀 + M3 的工具能力声明
- M11（安全）横切 M2/M3/M5/M6——所有进入大脑的内容过内容隔离，所有行动过权限
- M12（自省）依赖 M6 的 durable 事件流 + M7 的成本账本
- M7（治理）横切全部——不新增纵向能力，只加策略层

---

## M1 上下文投影层（Context Projection）— 最高优先

### 1.1 职责

**决定「这一轮 provider 请求，大脑看到什么」。** 这是预算管理员——所有进入 LLM 的内容必须经过它。

### 1.2 分层设计（三明治分层）

```
L0 系统核（不可裁剪，恒定）
   └─ 能力声明：你是谁、你能做什么、工具契约、权限边界、输出格式规则
L1 世界基线（每会话一次，压缩后常驻）
   └─ 环境快照：OS/工作目录/包管理器/git 状态/项目结构/可用命令
L2 指令层（按作用域叠加，优先级：会话 > 项目 > 全局）
   └─ AGENTS.md 链、用户偏好、会话级指令
L3 记忆层（按检索相关度注入，预算内）
   └─ 项目知识/决策日志/失败教训/用户偏好（来自 M5）
L4 历史层（分层投影：近全远摘要）
   └─ 最近 N 条消息全精度 → 中间段摘要 → 远端压缩为决策日志
L5 世界实时层（当前状态增量）
   └─ 文件系统变更、进程状态、会话状态（来自 M2/M6）
```

**层间规则**：
- 下层不可被上层挤出（L0/L1 永远在窗口内）
- 各层有预算上限（config 可调），超限时压缩下层优先于删除
- 层与层之间用清晰的 marker 分隔，大脑可区分「系统规则/世界事实/历史对话/当前状态」

### 1.3 核心功能

| 功能 | 说明 | 契约 |
|---|---|---|
| **分层投影** | 按上述 6 层组装请求内容 | 每层一个投影器，纯函数，可单独测试 |
| **预算分配** | 根据上下文窗口与任务类型分配各层预算 | `ContextBudget.allot(task, window)` → 每层 token 上限 |
| **历史压缩策略** | 近全远摘要，摘要保留决策而非过程 | 压缩器输出 `{ summary, decisions[], openQuestions[] }` |
| **工具输出投影** | 大输出 → 摘要 + 路径 + 关键行（配合 M3） | 投影规则注册在工具契约里 |
| **上下文清单** | 让大脑知道「我看到的内容构成」 | `context.inspect()` → 各层内容 + 预算使用 + 被压缩内容列表 |
| **Epoch 管理** | 基线上下文不可变，变更以增量消息注入（对齐 CONTEXT.md 的 Context Epoch） | 基线快照 + 增量消息序列 |
| **相关度注入** | M5 检索结果按与当前任务的语义相关度排序注入 | `ContextSource.retrieve(query, budget)` |
| **引用溯源** | 每个注入片段带来源引用（文件/记忆/事件），大脑可验证 | `SourceRef { kind, path?, line?, memoryID?, eventSeq? }` |
| **事实/假设标注** | 投影内容区分「已验证事实」与「推断假设」 | 片段级标注 `certainty: verified \| inferred \| stale` |
| **紧急预算处理** | 窗口即将溢出的预警与自动降级 | 85% 预警 → 90% 自动压缩 L5/L4 → 95% 强制 checkpoint |

### 1.4 深化细节

1. **关键信息近置**：当前焦点相关的内容（当前任务定义、正在处理的文件、最近决策）永远投影在注意力衰减半径内；远处只放低参与度的摘要
2. **上下文指纹**：每轮 provider 请求前生成注入内容的哈希指纹（供 M12 决策记录与回归对比）——同输入必须同输出，投影器是纯函数
3. **压缩可见性**：被压缩掉的内容不静默消失——压缩时生成「压缩清单」（什么被折叠成什么），大脑可要求展开
4. **指令幂等性**：重复注入同一指令不会改变语义（指令层去重），避免长会话中指令漂移
5. **临时上下文隔离**：用户单条消息附带的临时上下文（`#file` 引用、粘贴片段）与持久指令分离，下轮不残留
6. **投影测试基准**：每个投影器必须带「注入后正确率」基准用例（如：给投影器 10 个场景，模型首轮正确率不得低于基线）

### 1.5 现有实现映射

| 功能 | 现状 | 缺口 |
|---|---|---|
| Epoch 管理 | ✅ `session/context-epoch.ts` | — |
| System Context 代数 | ✅ `system-context/{index,registry,builtins}.ts`（组合/渲染/快照） | 缺 L4 历史压缩策略与 L3 记忆检索接入 |
| 工具输出有界 | ✅ `tool-output-store.ts` + registry settle | 缺「摘要 + 关键行」投影（现在只有截断） |
| 指令分级 | ✅ AGENTS.md 链 + instruction-context.ts | 缺会话级指令优先级 |
| 历史分层 | ⚠️ compaction.ts 分级（context-levels.ts） | 缺「决策日志」式摘要结构 |
| 预算可见性 | ❌ | 需新增 `context.inspect()` 面 |
| 引用溯源 | ❌ | 需 SourceRef 标注 |
| 紧急预算处理 | ❌ | 需预警/降级管线 |

### 1.6 技术实现规划（数据结构 / 算法 / 性能）

**数据结构**：

```ts
// 投影请求（每 provider turn 一次，纯函数组装）
interface ProjectionRequest {
  layers: LayerProjection[]        // 已按预算裁剪的各层内容
  budget: ContextBudget            // { system, world, instructions, memory, history, live } 每层 token 上限
  fingerprint: string              // 注入内容哈希（M12 决策记录用）
}

// 历史压缩产物（决策日志式）
interface CompactionSummary {
  objective: string                // 原始任务陈述（来自真实用户消息）
  progress: { done: string[], inProgress: string[], blocked: string[] }
  keyDecisions: { decision: string, reason: string, timestamp: number }[]
  nextSteps: string[]
  criticalContext: string          // 被压缩区域必须保留的上下文（路径/命令/约定）
  fileOps: { readFiles: string[], modifiedFiles: string[] }  // 被压缩历史中的文件操作清单
  supersedes: seq | null           // 增量更新时指向被替换的旧摘要
}

// Token 估算（usage 优先，估算兜底）
interface TokenEstimate {
  source: "provider-usage" | "heuristic"
  total: number
  usageTimestamp: number | null    // 时间戳防陈旧 usage（pi 设计）
}
```

**核心算法**：

1. **估算优先序**（✅ pi + opencode 现有）：主路径用 provider 真实 usage（最后一条 assistant 消息的 `usage.totalTokens`），只对 usage 之后的尾部消息做启发式估算（`Math.ceil(chars/4)` + 图片按 1200 token）；**时间戳守卫**——usage 消息时间戳 ≥ 最新 compaction 摘要时间戳才可信，否则回退估算（pi `estimateContextTokens`）
2. **compaction 切点选择**（✅ pi `findCutPoint`）：从尾部倒走累计估算 token，达 `keepRecentTokens`（20000）后选最近合法切点（排除 toolResult 与元数据条目）；若切点切进一个 turn（非 user 消息），回找 turn 起点，把 turn 拆成 `messagesToSummarize + turnPrefixMessages + retainedTail`
3. **增量 UPDATE 摘要**（✅ pi）：存在旧摘要时用 UPDATE 变体 prompt 增量更新（而非全文重写）；摘要请求用 `cacheRetention: "none"` + 全新 sessionId——**不污染 prompt cache**
4. **真实用户消息白名单**（✅ kimi-code）：压缩时按 `PromptOrigin` 分类——user/skill-activation 保留原样，injection/background/cron 丢弃，其余替换为一条 user 角色摘要；用户消息超预算（20000 token）时 head(2000)/tail(18000) 分段，中间插 `<system-reminder>` 省略标记
5. **第一人称交接笔记**（✅ kimi-code）：压缩 prompt 要求模型写「给自己的一手交接笔记」而非第三方总结——保留行动意图，恢复时接续更顺
6. **观测窗口上限回写**（✅ kimi-code）：收到 413/overflow 后用 `estimateRequestTokens × 0.85` 回写观测窗口上限，下次触发判定用 `min(配置值, 观测值)`

**性能约束**：
- 投影器纯函数：同输入必同输出（缓存友好 + 可测）；指纹 = 各层内容哈希，变更层才重投影
- 估算记忆化：`WeakMap<messageObject, estimate>` 防重复计算（kimi-code 同款）
- 分层预算分配 O(1)（查表），不每轮全量重算
- 压缩是同步阻塞操作（kimi-code 同步压缩；不后台化——避免「正在压缩时大脑继续思考」的一致性风险）

**来源裁决**：compaction 切点 + 增量摘要 + 时间戳守卫 + 白名单 + 交接笔记全部 ✅ 采纳（对齐现有 `context-levels.ts` 分级 + `compaction.ts` 模板）；「压缩请求不污染 cache」✅ 采纳；「观测窗口回写」✅ 采纳（现缺）。

---

## M2 世界感知层（World Perception）— 地基

### 2.1 职责

**把终端世界（文件系统/git/进程/网络/会话环境）变成结构化、可查询、可订阅的状态，供 M1 投影、M3 执行、M6 发布事件。**

### 2.2 分层设计

```
L0 状态存储（单一事实源）
   └─ 环境基线（EnvSnapshot）+ 文件树索引 + git 状态 + 进程表 + 会话元数据
L1 事件源（变更流）
   └─ watcher（文件系统）+ git hooks + 进程监听 + 会话事件 → 统一事件总线
L2 查询面（同步检索）
   └─ 文件内容/元数据、路径解析、git 查询、进程状态、环境变量
L3 命令面（副作用执行）
   └─ 启动进程、写文件、git 操作、网络请求（被 M3 工具调用，不直接暴露给大脑）
```

### 2.3 核心功能

| 功能 | 说明 | 契约 |
|---|---|---|
| **环境快照** | 会话开始时一次性采集基线 | `EnvSnapshot`：OS/arch/shell/cwd/包管理器/关键路径/可用命令探测结果 |
| **文件系统索引** | 项目文件树 + 忽略规则（gitignore） | `FileIndex`：目录树 + 文件大小/类型/修改时间 |
| **变更事件流** | 文件/git/进程变更发布为事件 | 事件：`{ type: "file.changed" \| "file.created" \| "file.deleted" \| "git.branchChanged" \| "process.exited", path?, payload? }` |
| **路径语义** | 绝对/相对/Location 作用域解析 | `LocationMutation.resolve`（已有） |
| **探查原语** | 低 token 代价的方向判断工具 | 文件树预览（depth 限制）、符号索引（函数/类）、依赖图（imports）、快读（首尾行） |
| **状态一致性** | 工具执行后世界状态与索引同步 | 写工具成功后触发索引增量更新 |

### 2.4 深化细节

1. **探查原语分级**（token 代价递减）：
   - `peek(dir, depth=2)` — 目录树预览，~50 token
   - `symbols(glob)` — 函数/类/符号表，~100 token
   - `imports(file)` — 单文件依赖图，~50 token
   - `head(file, n=20)` / `tail(file, n=20)` — 快读首尾
   - 大脑先用 peek 定位，再用 read 深入——避免「先猜路径再试错」
2. **事件去抖与批量**：瞬时大量变更（npm install、git checkout）合并为一个批量事件（`batch: N files`），不轰炸大脑
3. **事件与索引一致性**：事件发布先于索引更新，查询面永远最终一致（不做强一致承诺，但大脑不会看到「事件说改了、索引说没改」的永久分歧）
4. **慢变/快变状态分离**：git 状态、依赖树是慢变（缓存）；文件内容、进程状态是快变（实时）。大脑查询时给缓存新鲜度标记（`age: 12s`）
5. **git 语义化**：变更事件带语义而非裸 diff——`git.branchChanged`、`file.modified(3 files)`，需要时大脑才请求具体 diff
6. **外部进程世界**：后台任务（build/install）的生命周期可查询、可订阅（联动 M4 BackgroundJob）

### 2.5 现有实现映射

| 功能 | 现状 | 缺口 |
|---|---|---|
| 文件系统 watcher | ✅ `filesystem/watcher.ts`（发布 FileSystemWatcher.Event） | — |
| 工具编辑事件 | ✅ edit/write 发布 `file.edited` | — |
| ripgrep/搜索 | ✅ `ripgrep.ts` + `filesystem/search.ts`（后台索引） | 索引是「搜索用」，非「状态快照用」 |
| 环境快照 | ❌ | 需新增 EnvSnapshot 采集器 |
| 探查原语 | ❌ | 需新增 peek/symbols/imports/head |
| git 状态感知 | ⚠️ `git.ts` | 缺事件化（branch/status 变更通知） |
| 事件去抖 | ❌ | 需批量合并 |

### 2.6 技术实现规划（数据结构 / 算法 / 性能）

**数据结构**：

```ts
// 环境基线（每会话一次，L1 常驻）
interface EnvSnapshot {
  os: { platform, arch, shell, version }
  cwd: AbsolutePath
  packageManager: "bun" | "npm" | "pnpm" | "yarn" | null   // 探测：lockfile 存在性
  git: { branch, status: "clean" | "dirty", remoteURL: string | null }   // 5s 超时并行探测，逐项降级
  keyPaths: { home, configDir, dataDir, worktree }
  toolAvailability: Record<string, boolean>   // git/node/bun/jq… 存在探测（缓存 1 天）
}

// 文件索引（增量维护）
interface FileIndex {
  tree: TrieNode                      // 目录树（路径 → 节点）
  entries: Map<AbsolutePath, FileEntry>  // { size, mtime, type, hash? }
  searchIndex: MiniDbIndex | null     // 全文索引（可重建派生缓存，见 M5）
  generation: number                  // 版本号（变更事件递增）
}

// 事件（去抖后）
interface WorldEvent {
  type: "file.changed" | "file.created" | "file.deleted" | "file.batch" |
        "git.branchChanged" | "git.statusChanged" | "process.exited" | "process.batch"
  paths?: AbsolutePath[]
  count?: number            // batch 合并数
  seq: number               // 全局时钟（与 M6 共用）
}
```

**核心算法**：

1. **git-context 并行探测**（✅ kimi-code `<git-context>` 块）：spawn 时并行探测 `remote/branch/status/log`，5s 超时、remote URL 白名单脱敏（不把私有 URL 注入上下文）、失败逐项降级（不整体失败）
2. **事件去抖与批量**（✅ kimi-code 批量 + 上游 watcher）：窗口内（如 500ms）同类事件合并为 `file.batch { count, paths[] }`；npm install / git checkout 触发的大批量变更只发一个事件
3. **增量索引**（✅ kimi-code minidb 增量字节偏移）：搜索索引维护 `wire.jsonl` 字节偏移锚点，只重读新增字节区间；索引是 Store 的**纯派生缓存**——崩溃即从 Store 重建，永不丢
4. **全文索引**（✅ kimi-code minidb）：拉丁词 + **CJK 单字/双字** 分词（零依赖，中文无需 segmenter）；(doc, term) postings 落盘文件 + LRU 小缓存；TF-IDF 打分；单文档超长 token 直接丢弃防索引中毒；每 2048 文档让出事件循环

**性能约束**：
- EnvSnapshot 仅会话开始采集一次；toolAvailability 缓存 1 天（不每次 spawn 探测）
- 事件去抖窗口内合并 → 大脑不被打爆；索引增量更新 O(变更量)
- 搜索与状态快照分离：搜索走全文索引（查询时按词读盘），快照走 FileIndex 树（O(1) 内存查询）
- 写工具成功 → 索引增量更新（同步，不改索引不返回；保证「事件说改了、索引就查得到」）

**来源裁决**：git-context 并行探测 ✅ 采纳；事件去抖批量 ✅ 采纳；增量字节偏移索引 ✅ 采纳（对齐现有 `filesystem/search.ts` 后台索引，升级为可重建派生索引）；CJK 双字分词 ✅ 采纳（零依赖高价值）；TF-IDF 检索 ✅ 采纳。

---

## M3 工具系统（Tool System）— 行动通道

### 3.1 职责

**定义大脑触达世界的唯一通道：工具契约、参数校验、输出投影、失败分类。** 大脑用错工具 90% 是因为契约不清；输出无界 80% 是因为没有投影。

### 3.2 分层设计

```
L0 契约层（声明）
   └─ ToolContract：name / description（何时用/何时不用/坑）/ inputSchema / outputProjection / failureMode / idempotency / concurrency
L1 注册层（发现）
   └─ ToolRegistry：内置工具 + 插件工具 + MCP 工具 → 统一的工具清单（给模型的 tools 数组）
L2 执行层（运行）
   └─ 参数校验 → 权限检查 → 执行 → 结果投影 → 事件发布
L3 投影层（输出塑造）
   └─ 有界输出（预览+路径）/ 结构化结果 / 失败语义化 / 增量输出
L4 权限层（安全边界）
   └─ PermissionV2 ruleset + per-session 覆盖（SessionToolPermissions）+ BashArity 前缀审批
```

### 3.3 核心功能

| 功能 | 说明 | 契约 |
|---|---|---|
| **工具契约** | 每个工具必须声明完整契约，缺省禁止注册 | `ToolContract { name, description, input, output, failure, outputProjection, idempotent?, parallel? }` |
| **描述质量规范** | description 必须含「用途/触发条件/常见坑/参数语义」 | 生成 tools 数组时校验描述长度与结构 |
| **输出有界投影** | 大输出三件套：摘要 + 落盘路径 + 关键行号 | `ProjectedOutput { preview, outputPaths[], summary?, highlights[] }` |
| **失败语义化** | 失败按类别返回：NotFound/Permission/Timeout/Resource/Env 等 | `ToolFailure { kind, message, cause?, retryHint? }` |
| **增量输出** | 重跑命令时对比上次输出，只给变化部分 | 工具可选 `incremental` 模式 |
| **组合工具** | 预置多步操作减少往返（test-and-report/verify-refactor） | 组合工具 = 编排其他工具的元工具 |
| **工具执行事件** | 开始/运行/完成/失败全程发布（供 M6） | `tool.started/running/completed/failed` |
| **并行工具调用** | 一次行动可并行执行多个独立工具 | `parallel: true` 的工具可并发；结果按序返回 |
| **幂等性声明** | 工具声明是否可安全重试（决定大脑重试策略） | `idempotent: true` → 失败可无脑重试；false → 重试前先确认副作用 |

### 3.4 深化细节

1. **工具描述结构模板**（强制）：
   ```
   Use when: <触发场景，具体化>
   Do NOT use for: <易混淆场景>
   Common pitfalls: <该工具最常见的 2-3 个坑>
   Args: <每个参数的语义、默认值、单位>
   ```
2. **并行工具规则**：并行组内工具必须互相独立（无共享可变状态）；系统检测到疑似依赖（一个工具的输出是另一个的输入）时提示大脑串行
3. **重试引导**：失败时 `retryHint` 给「可直接重试 / 需改参数重试 / 换工具」三选一，并说明依据（幂等性 + 失败类别）
4. **输出一致性契约**：同一工具对同一输入的输出格式必须稳定（schema 锁定），大脑可依赖「上次怎么解析这次就怎么解析」
5. **工具结果缓存**：无副作用 + 输入可哈希的工具（grep/glob/read 元数据）结果按 (工具, 参数哈希, 文件 mtime) 缓存，重复调用零成本
6. **读工具分层**：`read(file)` 全量；`read-head(file, n)` / `read-tail` / `read-range(file, start, end)` 分块——大文件大脑按需取段，不一次吃满
7. **写工具变更摘要**：edit/write 完成后给「变更了什么」的摘要（文件+行数+符号级），而不是静默成功
8. **工具间契约一致性**：read 看到的就是 write 写的（写后索引即时更新），工具间无「认知缝隙」

### 3.5 现有实现映射

| 功能 | 现状 | 缺口 |
|---|---|---|
| 注册表 | ✅ `tool/registry.ts` + `tools.ts` | — |
| 内置工具 | ✅ bash/read/write/edit/glob/grep/webfetch/websearch/todowrite/question/skill | 描述质量参差，需契约审计 |
| 输出有界 | ✅ registry settle → ToolOutputStore.bound | 缺 summary/highlights 投影 |
| 权限 | ✅ PermissionV2 + SessionToolPermissions + BashArity | — |
| 失败分类 | ⚠️ 各工具自定错误 | 缺统一 ToolFailure 契约 |
| 组合工具 | ❌ | 需设计元工具编排 |
| 增量输出 | ❌ | 需设计对比缓存 |
| 并行调用 | ❌ | 需并发执行器 |
| 幂等性声明 | ❌ | 需契约字段 + 重试引导 |
| 结果缓存 | ❌ | 需 (工具, 哈希, mtime) 缓存层 |

### 3.6 技术实现规划（数据结构 / 算法 / 性能）

**数据结构**：

```ts
// 工具契约（扩展）
interface ToolContract {
  name: string
  description: string              // Use when / Do NOT use for / Common pitfalls / Args
  input: Schema.Struct
  output: Schema.Struct
  outputProjection: {
    maxLines?: number              // 默认 2000（对齐 ToolOutputStore）
    maxBytes?: number              // 默认 50KB
    summary?: "auto" | "custom"    // auto=抽取式摘要；custom=工具自定义摘要函数
    truncateMode: "head" | "tail" | "head-tail"   // 文件读=head、命令输出=tail、混合=采样
  }
  failure: { categories: FailureCategory[] }   // NotFound/Permission/Timeout/Resource/Env/Injection
  idempotent: boolean              // 失败可无脑重试？决定 retryHint
  access?: ToolAccess[]            // 资源访问声明（并行调度用，见下）
  executionMode?: "parallel" | "sequential"   // 缺省 parallel
}

// 资源访问声明（冲突图调度的输入）
type ToolAccess =
  | { kind: "file"; op: "read" | "write" | "edit"; path: AbsolutePath; recursive?: boolean }
  | { kind: "global" }             // 全局互斥（如 bash 某些场景）
  | { kind: "network" }            // webfetch/websearch：与文件系统不冲突

// 并行组（一次行动多个工具）
interface ParallelToolCall {
  calls: ToolCall[]                // 源序（assistant 消息中的顺序）
  results: ToolResult[]            // 按源序稳定返回（不按完成时间）
  conflictedPairs: [ToolCallID, ToolCallID][]   // 冲突图检测出的串行对
}
```

**核心算法**：

1. **三阶段工具执行**（✅ pi `executeToolCalls`）：**preflight 串行**（`prepareArguments` 参数兼容 shim → schema 校验 → `beforeToolCall` 钩子可 block）→ **执行并行**（Promise.all / FiberSet，现有 opencode 已是每 tool call 一个 fiber）→ **按源序落盘**（结果消息按 assistant 原始顺序写，不按完成时间）
2. **资源冲突图并行调度**（✅ kimi-code `tool-scheduler.ts`）：每个工具声明 `ToolAccess`；并行前构建**冲突图**（读与读不冲突；任何写与重叠路径写冲突，前缀匹配含 recursive 包含关系；`global` 与一切冲突）；不冲突者并行，冲突者按源序串行——比 pi 的「批内任一 sequential 则整批串行」更细粒度
3. **per-file 串行队列**（✅ pi `withFileMutationQueue`）：全局 `Map<realpath, Promise链>`——**同一文件串行、不同文件并行**；写工具执行前入队该文件队列。这是默认并行安全的底层保证
4. **双限截断 + 临时文件 spill**（✅ pi `OutputAccumulator` + 现有 ToolOutputStore）：2000 行 / 50KB 先到先赢；UTF-8 字节安全截断（逐字符 `Buffer.byteLength` 累计，不切坏多字节）；超限 spill 到临时文件，模型拿「head/tail 各半采样 + marker + 路径」（现有 `bound()` 已实现 head/tail 采样，补 summary 投影）
5. **length 截断 fail 整批**（✅ pi）：`stopReason === "length"` 时该消息内所有 tool call 直接 fail 不执行（输出被截断的 tool call 参数不可信）
6. **幂等重试引导**：失败时 `retryHint` 由 `{ idempotent, failureKind }` 推导：idempotent + Timeout → 「可直接重试」；非幂等 + 任意 → 「先确认副作用再重试」；NotFound → 「换路径」；Injection → 「内容不可信」
7. **结果缓存**（✅ 参考）：无副作用 + 可哈希工具（grep/glob/read 元数据）按 `(工具, 参数哈希, 涉及文件 mtime 集)` 缓存；写工具成功后失效相关缓存
8. **渐进披露**（✅ kimi-code `select_tools`）：动态工具（MCP 批量、插件工具）不进顶层 `tools[]`（保 prompt 前缀字节稳定 → **保 prompt cache 命中**）；经 `<tools_added>/<tools_removed>` 公告 + 消息级 tools 注入，下一步即可执行

**性能约束**：
- 并行度受 `SubagentLimiter` 风格并发上限约束（不照抄 pi 的裸 Promise.all；opencode 现有 FiberSet 可加 semaphore）
- 冲突图构建 O(n²) 但 n = 单轮工具数（≤8），可忽略
- 输出截断 O(n) 单趟；spill 只在大输出时发生（常见路径零开销）
- 缓存键含 mtime → 文件变更自动失效，无需显式清理

**来源裁决**：三阶段执行 ✅ 采纳（opencode 已有后半）；冲突图 ✅ 采纳（比 pi 批级 sequential 更优）；per-file 队列 ✅ 采纳；length fail 整批 ✅ 采纳；渐进披露 ✅ 采纳（现有 sdk 生成面已类似）；结果缓存 ⚠️ 参考（价值中，实现成本低）；裸 Promise.all 无上限 ❌ 不采纳。

---

## M4 执行与委派层（Execution & Delegation）— 长任务能力

### 4.1 职责

**管理大脑的一次行动从发出到回收的完整生命周期：串行/并行、子代理委派、中断恢复、结果回收。** 让大脑可以「一次性发出多个独立子任务」并「只回收摘要」。

### 4.2 分层设计

```
L0 会话编排（进程级协调）
   └─ SessionRunCoordinator：同一 Session 的 drain 合并/串行、不同 Session 并发
L1 执行协调（turn 生命周期）
   └─ SessionExecution：process-global 协调器，resume/wake/interrupt/awaitIdle
L2 委派面（子代理）
   └─ SubagentExecutor（全局执行器，EventV2 驱动）+ SubagentRunner（location 作用域）
L3 任务原语（后台/并行）
   └─ BackgroundJob（跟踪后台任务）+ 并行组（fan-out/fan-in）
L4 恢复面（检查点）
   └─ 中断恢复 / 手动 compact 串行化 / 崩溃后继续
```

### 4.3 核心功能

| 功能 | 说明 | 契约 |
|---|---|---|
| **委派原语** | `delegate(task, { parallel, budget, readonly }) → 结果摘要` | 子代理隔离上下文、独立 tool 权限、结果以摘要回收 |
| **并行组** | 一次发多个独立子任务，并行执行，按序收结果 | `ParallelGroup { tasks[], results[] }` |
| **子代理隔离** | 子代理不污染父会话：权限/环境/记忆隔离，共享工作区 | 只读默认（SUBAGENT_READONLY_RULES）+ 显式提权 |
| **失败传播** | 子代理失败结构化传回：原因 + 已尝试 + 建议 | `SubagentFailure { reason, attempted, suggestion }` |
| **后台任务** | 大脑启动的长任务（build/install/test）异步跟踪，完成通知 | BackgroundJob 状态机：running/succeeded/failed/promoted |
| **中断恢复** | 会话被打断（用户插话/模型切换/进程重启）后恢复 | 检查点 = durable 事件序列 + 游标 |
| **多会话并发** | 不同 Session 可同时运行 | SessionRunCoordinator（已有） |
| **容量限制** | 子代理并发数/总 token 预算限制 | SubagentLimiter（已有 `subagent/limiter.ts`） |

### 4.4 深化细节

1. **委派任务描述模板**（决定回收质量）：
   ```
   Goal: <明确目标>
   Constraints: <约束：只读？哪些路径？模型？>
   Acceptance: <完成标准，可自检>
   Budget: <token/时间上限>
   Report: <需要回传的内容：结论/决策/产出物/未完成项>
   ```
2. **委派结果回收结构**：`{ summary, decisions[], artifacts[], openQuestions[], spent }`——大脑只读 summary + decisions，需要时再展开
3. **并行组 fan-out 条件**：任务间无共享可变状态、无顺序依赖；系统预检（两个任务写同一文件 → 拒绝并行并提示）
4. **并行组 fan-in 合并**：结果按任务顺序稳定排列（不按完成时间），大脑解析不依赖时序
5. **子代理的上下文构造**：子代理看到「父会话的裁剪投影（决策日志级）+ 委派任务描述 + 世界基线」——不给全量历史，防串扰
6. **多会话交接（handoff）**：任务跨会话继续时，交接摘要 `{ goal, progress, decisions, nextSteps, openQuestions }` 注入新会话（联动 M5/M8）
7. **中断恢复的上下文重建**：恢复时重建「世界基线（M2 重新快照）+ 任务栈（M8）+ 决策日志（M5）」三件套，再继续
8. **委派风暴防护**：同一父会话的子代理总数/深度限制（防大脑无脑分叉 100 个任务）

### 4.5 现有实现映射

| 功能 | 现状 | 缺口 |
|---|---|---|
| 会话编排 | ✅ `session/run-coordinator.ts` | — |
| 执行协调 | ✅ `session/execution/local.ts`（process-local） | 跨进程恢复未实现（spec 登记） |
| 子代理 durable 管线 | ✅ `subagent/{runner,executor}.ts` + live 事件 requested/result | — |
| 只读默认 | ✅ SessionToolPermissions + SUBAGENT_READONLY_RULES | — |
| 后台任务 | ✅ `background-job.ts` | — |
| 并行组 | ❌ | 需新增 fan-out/fan-in 原语 |
| 失败传播结构化 | ⚠️ 有 SubagentResult | 缺统一 suggestion 语义 |
| 中断恢复检查点 | ⚠️ durable 事件可回放 | 缺「恢复后上下文重建」设计 |
| 交接摘要 | ❌ | 需 handoff 结构 |

### 4.6 技术实现规划（数据结构 / 算法 / 性能）

**数据结构**：

```ts
// 委派请求（大脑发起）
interface DelegateRequest {
  task: string
  profile: "coder" | "explore" | "plan" | "custom"   // 内置三件套或自定义（M10 技能）
  constraints: { readonly?: boolean; allowedPaths?: AbsolutePath[]; deniedPaths?: AbsolutePath[] }
  model?: ModelID                        // 缺省用子代理模型（M7 分级路由）
  budget: { maxTokens?: number; maxDurationMs?: number }
  report: "summary" | "full"             // 回传粒度
}

// 子代理结果（父只看摘要；最短摘要保底）
interface SubagentResult {
  summary: string                        // 最后一条 assistant 文本（父会话唯一可见内容）
  decisions?: string[]                   // 关键决策（可选，父按需展开）
  artifacts?: { path: AbsolutePath; note: string }[]
  openQuestions?: string[]
  spent: { tokens, cost }
  resumeID: SubagentID | null            // 可续跑（崩溃/超时后 Agent(resume=id)）
}

// 并行组
interface ParallelGroup {
  tasks: DelegateRequest[]
  results: SubagentResult[]              // 按提交序稳定返回
  concurrency: number                    // 初始并发（默认 5）
}
```

**核心算法**：

1. **子代理协议：父只看子最后一条消息**（✅ kimi-code）：父会话只回收 `summary`（子代理的最后一条 assistant 文本）；**最短摘要保底**——summary < 200 字符时注入「你的回复过短，请补充关键结论」再跑一轮（最多 1 次）——防子代理敷衍收尾
2. **持久化委托 + resume**（✅ kimi-code `Agent(resume=id)`）：子代理会话 durable（已有 create 子会话基础）；超时/失败时结果带 `resumeID`，父可发 `delegate(resume=id)` 续跑——**崩溃可恢复的委派**，而非一次性
3. **git-context 注入**（✅ kimi-code）：spawn 子代理时并行探测 `remote/branch/status/log`（5s 超时、逐项降级、remote URL 脱敏）注入其上下文——子代理开局就懂仓库状态
4. **swarm 限流感知调度**（✅ kimi-code `AgentSwarm`）：初始并发 5、每 700ms 放 1 个；遇 provider 限流进入「限流相位」——重排任务、退避 3s→6s→12s 翻倍、容量收缩、3 分钟无限流恢复 +1 容量
5. **冲突预检**（✅ 结合 M3 冲突图）：并行组任务写同一文件 → 拒绝并行并提示（任务描述中无法静态检测时，运行时 per-file 队列兜底）
6. **委派风暴防护**：同一父会话子代理总数/深度限制（结合现有 SubagentLimiter）；kimi 用 `MAX_CONCURRENCY=4` worker 池 + `MAX_PARALLEL_TASKS=8` 作参照
7. **三件套默认 profile**（✅ kimi-code）：`explore`（只读 + 要求并行发起多个 grep/read）、`plan`（无 shell、交付物=计划文本）、`coder`（全权实现）；`whenToUse` 字段拼进主代理的 Agent 工具描述——大脑学习何时选哪个

**性能约束**：
- 并发调度有上限（初始 5、限流收缩），不裸 Promise.all
- 结果回收 O(summary 长度)，父上下文只吃摘要（M1 预算保护的核心）
- 子代理会话独立 durable——resume 时读投影即可重建，不重放父历史

**来源裁决**：父只看最后一条 + 最短摘要保底 ✅ 采纳；resume 持久化委托 ✅ 采纳（与现有 durable 子会话天然契合）；git-context 注入 ✅ 采纳；swarm 限流调度 ✅ 采纳；三件套 profile ✅ 采纳；冲突预检 ✅ 采纳；进程隔离子代理（pi）❌ 不采纳（fork 已有 in-process durable 子会话，进程隔离反而丢持久化）。

---

## M5 记忆层（Memory）— 跨会话能力

### 5.1 职责

**持久化大脑的跨会话知识：项目知识、决策日志、用户偏好、失败教训。可写入、可检索、按需注入（与上下文解耦）。**

### 5.2 分层设计

```
L0 存储（结构化条目）
   └─ Memory 条目：{ id, category, title, content, keywords, created_at, updated_at, sourceRef?, confidence? }
L1 写入面
   └─ 主动写入（大脑调用 remember）/ 自动沉淀（会话摘要、失败记录、偏好学习）
L2 检索面
   └─ 关键词检索 + 语义检索（向量可选）+ 按 category/时间过滤
L3 注入面
   └─ 与 M1 衔接：按当前任务相关度排序注入预算内
L4 治理面
   └─ 去重/过期/合并（用户确认后才写、可删除可编辑）
```

### 5.3 核心功能

| 功能 | 说明 | 契约 |
|---|---|---|
| **项目级记忆** | 项目架构决策/约定/常用命令/坑，跨会话持久 | `remember(project, entry)` / `recall(project, query)` |
| **会话决策日志** | 长会话自动生成决策日志，新会话开始时注入 | `SessionDecisions { decisions[], openQuestions[] }` |
| **偏好学习** | 用户批准/拒绝模式自动沉淀为规则 | 从 Permission 事件流提取 → 规则条目（用户确认后生效） |
| **失败教训库** | 大脑犯过的错（尤其工具用法）持久化避免重蹈 | 从工具失败事件自动记（可配置） |
| **检索原语** | `remember(查询)` 给相关片段而非全量 | 关键词匹配 + 可选向量，返回 top-K 片段 |
| **记忆治理** | 无用户确认不写、可列出/删除/编辑 | `memory list/delete/update` 命令面 |

### 5.4 深化细节

1. **时间衰减**：检索排序按「相关度 × 时间衰减」——30 天前的项目约定权重低于最近的；但「用户显式确认」的记忆不过期
2. **冲突处理**：新旧记忆冲突（项目改用了 pnpm）→ 新条目标注 supersedes 旧条目，旧条目降权但仍可查（供审计）
3. **引用溯源**：每条记忆带来源（哪次会话/哪次用户纠正/哪个文件），大脑注入时可判断可信度（联动 M1 SourceRef）
4. **确认流分级**：
   - 主动写入（大脑 remember）→ 直接存
   - 自动沉淀（偏好/教训）→ 标记 `pending`，用户确认或大脑复用 3 次后转正
5. **记忆容量治理**：条目上限 + 合并相似条目 + 摘要化长记忆（决策日志压成一条摘要）
6. **会话记忆摘要时机**：会话自然结束 / 手动 compact / 会话 fork 时生成决策日志——不在每轮生成（省成本）
7. **敏感信息过滤**：记忆写入时脱敏（密钥/token/路径泄漏检测），不入库（联动 M11）

### 5.5 现有实现映射

| 功能 | 现状 | 缺口 |
|---|---|---|
| 存储 | ✅ `memory/store.ts`（memories.json，category 含 project/feedback/user/reference） | 仅 getIndex 存活，CRUD 被裁 |
| 会话上下文 | ✅ `memory/context.ts` | — |
| 自动沉淀 | ❌ | 需从事件流接入（决策日志/偏好/教训） |
| 检索 | ⚠️ keywords 字段 | 缺语义检索 + 与 M1 的注入衔接 |
| 治理面 | ❌ | 需完整 CRUD + 确认流 |
| 时间衰减/冲突 | ❌ | 需排序策略 |

### 5.6 技术实现规划（数据结构 / 算法 / 性能）

**数据结构**：

```ts
// 记忆条目（对齐现有 Memory + 扩展）
interface Memory {
  id: string
  category: "user" | "feedback" | "project" | "reference" | "lesson"
  title: string
  content: string
  keywords: string[]
  created_at: number
  updated_at: number
  sourceRef?: SourceRef          // 来源（会话/用户纠正/文件）→ 可信度
  status: "confirmed" | "pending"   // 自动沉淀的条目待确认
  supersedes?: string[]          // 被本条替代的旧条目 id
  confidence?: number            // 0-1（时间衰减 + 确认加权）
}

// 会话决策日志（M1 压缩产物，M5 沉淀）
interface SessionDecisions {
  decisions: { decision: string; reason: string; timestamp: number }[]
  openQuestions: string[]
  sessionID: SessionID
}
```

**核心算法**：

1. **事件溯源 wire 存储**（✅ kimi-code `wire.jsonl`）：会话/记忆以追加式事件日志存储——追加批写 + `fh.sync()` + 目录 fsync；compaction 用单次截断重写；读取容忍末尾半行（崩溃容忍）；`state.json` 自描述会话状态；排序按文件 mtime 而非字段
2. **无锁 append-only 索引**（✅ kimi-code `session_index.jsonl`）：索引文件 O_APPEND 原子追加 + tombstone（`deleted: true`）；进程内串行队列；读取时 `isPathInside` 校验防路径逃逸
3. **blob offload**（✅ kimi-code `blobref.ts`）：大媒体/工具输出存引用不存字节——记忆条目保持轻量
4. **全文检索**（✅ kimi-code minidb）：与 M2 共用一套索引（词项字典 + CJK 双字分词 + TF-IDF + postings 落盘 + LRU）；`recall(project, query)` 按 TF-IDF 排序取 top-K
5. **时间衰减排序**（✅ 参考 + 自研）：检索分 = TF-IDF × 时间衰减因子 × 状态加权（confirmed > pending）；用户显式确认的记忆不过期
6. **冲突 supersedes**（✅ kimi-code 迁移分类启发）：新条目标注 supersedes 旧条目（如「项目改用了 pnpm」），旧条目降权但仍可查（审计）
7. **确认流**：主动写入（大脑 remember）→ 直接存 confirmed；自动沉淀（偏好/教训，从 M6 事件流提取）→ 存 pending，用户确认或复用 3 次转正
8. **敏感信息过滤**（✅ 结合 M11）：写入时脱敏（密钥/token/路径泄漏检测），不入库

**性能约束**：
- 追加写 O(1) 摊销（无锁 append）；索引重建 O(n log n) 仅在崩溃后（纯派生缓存，可重建）
- 检索读盘按词（postings 落盘）+ LRU 缓存——内存常驻只放字典/长度/键映射
- 全文索引构建每 2048 文档让出事件循环（不阻塞主线程）
- **锁即选举**（✅ kimi-code `searchService.ts`）：多进程共享同一记忆库时，抢到写锁的进程成为索引器，其余进程只读；索引器死亡后下一个打开者自动接任——单写者模型防竞争

**来源裁决**：wire 事件溯源 ✅ 采纳（与现有 EventV2 durable 思想一致，记忆层复用同模式）；无锁索引 + tombstone ✅ 采纳；blob offload ✅ 采纳；minidb 全文检索 ✅ 采纳（与 M2 共用）；锁即选举 ✅ 采纳；时间衰减/确认流 ✅ 采纳。

---

## M6 事件与反馈层（Events & Feedback）— 观察面

### 6.1 职责

**把「世界发生了什么」和「我的行动进展如何」以结构化事件流交付给大脑。** 让大脑在轮次之间感知变化，而不是盲目等待或轮询。

### 6.2 分层设计

```
L0 事件源（生产者）
   └─ 世界事件（M2：file.changed/git/process）+ 执行事件（M3/M4：tool/step/subagent）+ 用户事件（feedback/interrupt）
L1 事件总线（传输）
   └─ EventV2（bus.ts）：durable 事件（可回放）+ live 事件（实时）
L2 订阅面（消费）
   └─ 进程内订阅（插件/协调器）+ 进程外订阅（SSE/SDK）
L3 反馈提炼（供大脑）
   └─ 从事件流提炼：执行状态汇总、失败归因、成本累计、用户反馈注入
```

### 6.3 核心功能

| 功能 | 说明 | 契约 |
|---|---|---|
| **执行反馈流** | 工具/步骤状态流转实时发布 | `tool.started → running → completed/failed`；step 级同理 |
| **用户反馈通道** | 用户中途插话/纠正/批准/拒绝作为事件注入 | `user.interrupted / user.corrected / permission.granted / permission.denied` |
| **失败归因** | 错误分类（provider/tool/permission/timeout）供大脑决策 | `ErrorFingerprint { category, provider?, tool?, retryable }` |
| **成本实时反馈** | 每步 token/成本累计发布 | `usage.updated { step, cost, tokens }`（配合 M7） |
| **会话状态可见** | 大脑可查询当前会话状态 | `session.status`：waiting_tool/waiting_user/thinking/completed |
| **事件回放** | durable 事件按游标回放（断线恢复/新会话接续） | `event?after=cursor`（已有） |

### 6.4 深化细节

1. **进度汇报节奏**：深度任务中每完成一个 M8 计划节点发一次「进度报告」（已做/剩余/偏差），用户可见、大脑可自省——不是每工具一次（噪音）
2. **长任务心跳**：超 60s 的工具执行发心跳（`still running: Ns, progress?`），大脑和用户都能区分「正常慢」与「挂死」
3. **用户方向确认（checkpoint）**：任务执行到「高成本/不可逆/方向分叉」节点时，主动请求用户确认（`question` 工具已存在，补策略触发条件）
4. **事件去重与幂等**：同一状态重复发布（重启后的 replay）不产生重复语义；事件带 seq 供大脑判重
5. **跨流时序**：世界事件（file.changed）与执行事件（tool.completed）共用一个时钟（seq），大脑可重建「修改→验证→通过」的因果链（供 M12 归因）
6. **思考过程可见性**：大脑的 reasoning 流式发布为 `thinking.chunk` 事件（已有基础），用户可见（信任建设）、TUI 渲染（subtleSyntax 已有）

### 6.5 现有实现映射

| 功能 | 现状 | 缺口 |
|---|---|---|
| 事件总线 | ✅ EventV2（bus.ts）+ durable/live 双轨 | — |
| 执行反馈 | ✅ tool.progress 接线 + step 事件 + `session.next.failed` | — |
| SSE 订阅 | ✅ instance httpapi event group | — |
| 用户反馈注入 | ⚠️ 用户消息即事件（prompted） | 缺 interrupt/corrected 语义事件 |
| 失败归因 | ⚠️ LLMError/TransportReason 分类 | 缺统一 ErrorFingerprint 面 |
| 成本实时反馈 | ⚠️ projector 累计 cost/tokens 落库 | 缺实时事件发布 |
| 会话状态可见 | ⚠️ sessions.active() | 缺细粒度状态机暴露 |
| 进度汇报 | ❌ | 需按计划节点汇报 |
| 心跳 | ❌ | 需长任务心跳 |

### 6.6 技术实现规划（数据结构 / 算法 / 性能）

**数据结构**：

```ts
// 流式事件协议（✅ pi：错误编码在消息里，流永不 reject）
interface StreamEvent {
  kind: "text.start" | "text.delta" | "text.end" |
        "thinking.start" | "thinking.delta" | "thinking.end" |
        "toolcall.start" | "toolcall.delta" | "toolcall.end" |
        "done" | "error"                      // done/error 也带最终消息（含 stopReason）
  message?: AssistantMessage                  // start 时推入 partial，delta 原地替换
  stopReason?: "end" | "tool_use" | "length" | "error" | "aborted"
}

// 执行反馈
interface ToolLifecycleEvent {
  phase: "started" | "running" | "completed" | "failed"
  tool: ToolName
  callID: ToolCallID
  progress?: { pct?: number; note?: string }   // 长任务心跳（>60s 触发）
  seq: number
}
```

**核心算法**：

1. **流永不 reject、错误编码进最终消息**（✅ pi `AssistantMessageEventStream`）：`stopReason: "error" | "aborted"` + `errorMessage` 是最终消息的一部分——循环层无需 try/catch 分流，错误与正常结果同管道处理
2. **steer 缓冲 + compaction 后 flush**（✅ kimi-code `steerBuffer`）：prompt 启动新 turn；steer 在 turn 活跃或 compaction 持有时**进缓冲**（返回 null，fire-and-forget），在 step 边界 compaction 之后 flush——**保证 steer 消息不被压缩丢弃**
3. **取消原因随 signal 传播**（✅ kimi-code `signal.reason`）：中断时 signal 携带原因（用户中断 vs 超时/系统中止），工具据此向大脑报告「deliberate user action」——大脑能区分「用户打断」与「系统故障」
4. **turn.ended 与 activeTurn 释放同一同步帧**（✅ kimi-code）：保证「turn.ended 即会话可观测空闲」——无竞态的状态可见性
5. **事件去重与幂等**：事件带 seq；replay 后重复事件由 seq 判重（现有 EventV2 已有）
6. **进度汇报节奏**：每完成一个 M8 计划节点发一次进度报告（已做/剩余/偏差）——不是每工具一次

**性能约束**：
- delta 事件原地替换 partial 消息（O(1) 不重建）；流式渲染防闪已有（TUI）
- 心跳仅在 >60s 工具触发（不打扰短任务）
- 缓冲队列有界（steer 缓冲上限防内存膨胀）

**来源裁决**：错误编码进消息 ✅ 采纳；steer 缓冲 + compaction 后 flush ✅ 采纳（现有 steer 语义已类似，补 flush 顺序约束）；取消原因传播 ✅ 采纳；turn.ended 同步帧 ✅ 采纳。

---

## M7 成本与模型治理层（Cost & Model Governance）— 横切

### 7.1 职责

**横切所有模块的策略层：模型路由策略、成本可见性、Provider 容灾。不新增纵向能力，只做「用哪个模型、花多少钱、失败了怎么办」的决策。**

### 7.2 分层设计

```
L0 模型解析（谁可用）
   └─ Catalog + models-dev 快照 + provider 可用性判定（catalog.ts 已有）
L1 路由策略（用哪个）
   └─ 主任务用配置模型 / 子代理小模型 / 复杂度触发降级升级
L2 成本账本（花多少）
   └─ usage 累计（session 级/step 级）+ 实时可见性
L3 容灾策略（失败怎么办）
   └─ provider 失败重试 / 回退备用 provider / 降级提示
```

### 7.3 核心功能

| 功能 | 说明 | 契约 |
|---|---|---|
| **模型分级路由** | 按任务复杂度选择模型（配置策略 + 可选自动判定） | `ModelPolicy { main, subagent, cheap, maxCostPerTask? }` |
| **子代理用小模型** | 委派任务默认用便宜模型，可覆盖 | SubagentExecutor 注入 model 选择 |
| **成本可见性** | `stats` 实时可查 + 会话内实时反馈 | `UsageLedger { sessionTotal, stepBreakdown, byModel }` |
| **Provider 容灾** | 主失败自动回退备用 | `ProviderFailover { primary, fallback[], retryPolicy }` |
| **预算闸门** | 单任务成本上限，超限提示大脑决策（继续/换路/收尾） | `CostBudget { limit, alertAt, hardStopAt }` |

### 7.4 深化细节

1. **模型自我认知**：大脑需要知道「我是谁」（当前模型/能力边界/价格档位）——注入 L0 系统核；`model.info()` 可查
2. **切换建议触发条件**：
   - 任务难度信号（工具调用失败率 > 阈值、重试 > 2 次）→ 建议升级模型
   - 机械任务（格式化/批量替换）→ 建议降级小模型
   - 预算警报 → 建议降级或收尾
3. **预算闸门三档**：`alertAt`（告知大脑剩余预算 + 建议）→ `hardStopAt`（强制停止并给摘要，防失控）→ 用户可解除
4. **成本归属分级**：按任务（M8 节点）→ 会话 → 项目三级累计，复盘（M12）可看「哪个任务最烧钱」
5. **单价感知路由**：策略可配置「性价比优先」（同能力模型选单价低者），Provider 列表带单价元数据
6. **容灾不静默**：failover 切换时发布 `model.failover { from, to, reason }` 事件——大脑知道自己在用备用模型，调整对质量的心理预期

### 7.5 现有实现映射

| 功能 | 现状 | 缺口 |
|---|---|---|
| 模型解析 | ✅ `session/runner/model.ts` + catalog | — |
| 成本累计 | ✅ projector 落库 cost/tokens 列 + `stats` 命令（已恢复） | 缺 step 级实时事件 |
| 分级路由 | ⚠️ 子代理可选模型 | 缺策略层（自动降级/升级） |
| Provider 容灾 | ⚠️ retry.ts（RETRY_MAX_DELAY）+ stallTimeout | 缺回退备用 provider |
| 预算闸门 | ❌ | 需新增 |

### 7.6 技术实现规划（数据结构 / 算法 / 性能）

**数据结构**：

```ts
// 策略（config 声明）
interface ModelPolicy {
  main: ModelRef                    // 主任务模型
  subagent: ModelRef                // 子代理默认（便宜）
  fallback?: ModelRef[]             // 容灾链（主失败按序回退）
  costBudget?: { limit: number; alertAt: number; hardStopAt: number }  // 单任务
}

// 成本账本（三级累计：任务 → 会话 → 项目）
interface UsageLedger {
  byTask: Map<TaskID, Usage>        // M8 计划节点
  sessionTotal: Usage
  byModel: Map<ModelKey, Usage>
  alerts: { at: number; kind: "alert" | "hardstop" }[]
}
```

**核心算法**：

1. **usage 优先记账**（✅ pi + 现有 projector）：以 provider 返回的真实 `usage` 为准累计（cost/tokens 分列），无 usage 时回退估算（chars/4）；**时间戳守卫**防陈旧 usage 重复计入
2. **模型切换建议触发**（✅ 自研 + kimi 参照）：工具失败率 > 阈值 / 重试 > 2 次 → 建议升级；机械任务（格式化/批量替换）→ 建议降级；预算警报 → 建议降级或收尾
3. **预算闸门三档**：`alertAt`（告知剩余 + 建议）→ `hardStopAt`（强制停止 + 摘要）→ 用户可解除
4. **failover 不静默**（✅ 自研）：切换时发布 `model.failover { from, to, reason }` 事件——大脑知道自己在用备用模型，调整质量预期
5. **子代理默认小模型**（✅ 对齐 kimi secondary-model）：委派任务默认用 `policy.subagent`，可覆盖

**性能约束**：
- 成本累计走 projector 落库（批量写，不逐事件 fsync）；实时事件发布仅 step 级（不逐 token）
- 路由判定 O(1)（查表），不每轮全量重算
- 观测窗口回写（kimi）防 overflow 循环重试

**来源裁决**：usage 优先 + 时间戳守卫 ✅ 采纳；failover 事件 ✅ 采纳；预算闸门 ✅ 采纳；子代理小模型 ✅ 采纳（已部分实现）。

---

## M8 规划与任务栈层（Planning & Task Stack）— 长任务方向盘

### 8.1 职责

**管理大脑的长任务结构：任务分解、排序、进度跟踪、计划与现实的偏差检测。** 没有它，大脑在 10 步以内的任务会漂移；有了它，30 步任务可保持方向。

### 8.2 分层设计

```
L0 计划存储（持久化计划树）
   └─ PlanNode：大任务 → 子任务 → 步骤，每节点带目标/状态/验收标准/依赖/预算
L1 任务栈（执行位置）
   └─ 当前执行节点、待办队列、已完成集合、阻塞集合、依赖就绪检测
L2 进度跟踪（状态流转）
   └─ 节点状态机：pending → in_progress → blocked → done/failed；时间与 token 消耗
L3 偏差检测（计划 vs 现实）
   └─ 实际动作与计划对比：改的文件不在计划内、耗时超估、范围蔓延
```

### 8.3 核心功能

| 功能 | 说明 | 契约 |
|---|---|---|
| **计划树** | 任务的分层分解与持久化 | `PlanNode { id, parentID, title, goal, acceptanceCriteria[], status, dependsOn[], budget?, spent }` |
| **验收标准** | 每任务可定义完成标准（DoD），完成后自检 | 自检通过才可标 done |
| **依赖图** | 任务间依赖与就绪检测 | `dependsOn` 全部 done → 任务就绪 |
| **进度查询** | 大脑随时知道「我在哪、还剩什么」 | `plan.query()` → 当前节点/队列/阻塞 |
| **偏差告警** | 计划外动作检测（范围蔓延） | 写计划外文件 → `drift.warning` 事件 |
| **预算挂接** | 每任务 token/成本预算（联动 M7） | 任务预算用尽 → 提示收敛/拆分 |
| **任务存档** | 完成任务的决策记录（联动 M5） | 节点 done → 生成决策条目 |

### 8.4 深化细节

1. **todowrite 升级**：现有 todowrite 工具是最小实现——补「依赖、验收标准、预算」字段，保持向后兼容
2. **计划修订协议**：大脑发现计划不可行时，主动 `plan.update`（标注原因）而非静默偏离——偏差检测的输入是「显式修订」与「隐式漂移」的差分
3. **漂移分级**：轻微漂移（多读一个文件）→ 不打扰；中度（多改一个文件）→ 事件提示；重度（任务方向改变）→ 建议重新规划或请求用户确认
4. **checkpoint 语义**：计划节点可标记 checkpoint（用户可见的里程碑），M6 进度汇报按 checkpoint 汇报
5. **计划可视化**：`plan` 命令输出计划树（TUI 渲染），用户可干预（加任务/改优先级/暂停节点）——用户也是计划参与者
6. **恢复时计划重建**：中断恢复时计划树从 durable 事件重建（节点状态可回放）

### 8.5 现有实现映射

| 功能 | 现状 | 缺口 |
|---|---|---|
| 任务列表 | ⚠️ todowrite 工具（V1/V2 均有） | 缺计划树/依赖/预算/验收标准 |
| 持久化 | ⚠️ session_todo 表（V1） | 缺计划树结构 |
| 进度跟踪 | ⚠️ todo 状态事件 | 缺阻塞集合/就绪检测 |
| 偏差检测 | ❌ | 需动作-计划比对 |

### 8.6 技术实现规划（数据结构 / 算法 / 性能）

**数据结构**：

```ts
// 计划树（升级 todowrite：依赖/预算/验收标准）
interface PlanNode {
  id: TaskID
  parentID: TaskID | null
  title: string
  goal: string                          // 任务陈述（客观目标）
  acceptanceCriteria: string[]          // DoD：自检通过才可标 done
  status: "pending" | "in_progress" | "blocked" | "done" | "cancelled"
  dependsOn: TaskID[]                   // 依赖（全部 done → 就绪）
  budget?: { maxTokens?: number; maxDurationMs?: number }
  spent: { tokens: number; durationMs: number }
  checkpoint?: boolean                  // 用户可见里程碑（M6 进度汇报）
}

// 偏差事件（计划 vs 现实）
interface DriftEvent {
  kind: "minor" | "moderate" | "severe"
  detail: string                        // 如：写计划外文件 X / 任务方向改变
  suggested: "ignore" | "note" | "replan" | "ask-user"
}
```

**核心算法**：

1. **Goal 驱动的连续 turn 序列**（✅ kimi-code `driveGoal`）：把目标变成连续 turn 序列——每轮注入 `GOAL_CONTINUATION_PROMPT`（「你在执行目标 X，进度：…，下一步：…」）；预算（turn/token/墙钟）硬上限 → `markBlocked`；大脑用 UpdateGoal 声明 complete/blocked 控制循环。这是 M8 的运行时骨架——`todowrite` 是它的静态视图
2. **偏差检测差分**（✅ 自研 + pi 参照）：实际动作（M6 事件流）与计划（PlanNode）比对——写计划外文件 → drift.warning；**显式 `plan.update`（带原因）与隐式漂移的差分**是判定关键
3. **漂移分级**：minor（多读一个文件）→ 不打扰；moderate（多改一个文件）→ 事件提示；severe（方向改变）→ 建议重规划或请求用户确认
4. **依赖就绪检测**：PlanNode 状态机——`dependsOn` 全部 done → pending → in_progress（就绪队列扫描 O(n)）
5. **任务存档**：节点 done → 生成 M5 决策条目（决策/原因/产出）——「计划完成即记忆沉淀」

**性能约束**：
- 计划树常驻内存（数量小，O(n) 操作可忽略）；持久化走事件溯源（M5 wire 模式）
- 偏差检测是事件驱动的（不轮询）：M6 事件流 → 轻量匹配计划外路径（前缀集合查）
- 恢复时计划树从 durable 事件重建（节点状态可回放）

**来源裁决**：Goal 驱动 turn 序列 ✅ 采纳（todo 工具的运行时骨架）；偏差检测 ✅ 采纳；漂移分级 ✅ 采纳；依赖就绪 ✅ 采纳。

---

## M9 验证闭环层（Verification Loop）— 让「改完」变成「改对」

### 9.1 职责

**大脑每次修改后的系统化验证：自动触发验证器、语义化结果、回归跟踪。** 没有它，大脑靠「跑一遍试试」碰运气；有了它，「改 → 验证 → 修复」闭环自动化。

### 9.2 分层设计

```
L0 验证器注册（声明）
   └─ Verifier：typecheck/test/lint/build/格式化的声明（命令、触发条件、结果解析器）
L1 验证编排（触发与并行）
   └─ 修改事件 → 关联验证器自动触发（可配置开关）；多验证器并行
L2 结果语义化（解析）
   └─ 失败归因（哪个文件/哪行/什么错误）+ 通过摘要 + 耗时成本
L3 回归跟踪（历史）
   └─ 验证历史、已知失败白名单、新失败告警
```

### 9.3 核心功能

| 功能 | 说明 | 契约 |
|---|---|---|
| **自动验证触发** | edit/write 完成后自动跑关联验证（如改 .ts → typecheck） | 触发规则：文件后缀 × 验证器映射 |
| **验证批处理** | 一次跑多个验证器，并行，结果合并 | `VerificationResult { verifier, passed, failures[], duration }` |
| **失败语义化** | 失败定位到文件/行/符号 + 错误类别 | `Failure { file, line?, message, category }`（编译/类型/断言/超时） |
| **回归基线** | 已知失败 vs 新失败 | 白名单（可确认「这是已知的」）→ 新失败单独告警 |
| **验证建议** | 失败给修复方向（联动大脑推理） | 如编译错误 → 缺失 import/类型不匹配 |
| **验证预算** | 测试时长/成本上限（联动 M7） | 超时截断 + 报告「未完成部分」 |

### 9.4 深化细节

1. **触发粒度**：文件级（改一个文件跑单测而非全量）；依赖级（改了 utils.ts → 跑所有依赖它的测试，经 import 图反向推导）
2. **验证顺序**：快验先跑（lint/typecheck）→ 慢验后跑（e2e）——大脑先拿到快反馈修正低级错误，再等慢验证
3. **结果注入上下文**：验证结果按 M1 投影规则注入（失败详情进上下文、通过摘要一行）——失败驱动大脑下一步，通过不占预算
4. **验证-修复循环检测**：同一验证器失败 > N 次且无进展 → 建议换策略（不是继续烧钱重试），联动 M7 预算闸门
5. **已知失败管理**：`verify.known` 命令标记「这个失败已知、与本次修改无关」（如 pre-existing test fail），避免大脑被噪音误导
6. **与 M8 衔接**：计划节点的验收标准可由验证器结果自动判定（DoD = 关联验证器全绿）

### 9.5 现有实现映射

| 功能 | 现状 | 缺口 |
|---|---|---|
| 验证执行 | ⚠️ V1 processor 有部分（agent loop 内） | 无独立验证编排 |
| 失败解析 | ⚠️ 各命令输出裸文本 | 缺语义化解析器 |
| 自动触发 | ❌ | 需注册表 + 触发规则 |
| 回归基线 | ❌ | 需历史存储 |
| 验证建议 | ❌ | 需错误分类 → 建议映射 |

### 9.6 技术实现规划（数据结构 / 算法 / 性能）

**数据结构**：

```ts
interface Verifier {
  id: string                          // "typecheck" | "test" | "lint" | "build"
  command: string[]                   // 可执行
  triggers: { glob: string; verifier: string }[]   // 文件后缀 → 验证器映射
  parse: (output: string) => Failure[]  // 输出语义化解析器
  cost: "fast" | "slow"               // 快验先跑（lint/typecheck）vs 慢验后跑（e2e）
  dependencies?: string[]             // 依赖的验证器（组合）
}

interface VerificationResult {
  verifier: string
  passed: boolean
  failures: { file: AbsolutePath; line?: number; message: string; category: "compile" | "type" | "assert" | "timeout" }[]
  duration: number
  cost?: number
}
```

**核心算法**：

1. **验证-修复循环检测**（✅ 自研）：同一验证器连续失败 > N 次且无进展 → 建议换策略（不继续烧钱重试），联动 M7 预算闸门
2. **依赖级触发**（✅ 自研 + import 图）：改 `utils.ts` → 反向推导依赖它的测试（import 图反向索引，M2 符号索引的扩展）
3. **快验先跑**：lint/typecheck（fast）→ test（slow）→ e2e（slower）顺序执行；大脑先拿快反馈修低级错误
4. **回归基线**：`verify.known` 命令标记「已知失败、与本次修改无关」白名单；新失败单独告警——防 pre-existing fail 噪音误导大脑
5. **失败语义化**：解析器把裸输出转 `{ file, line, message, category }`（compile 错误 → 缺失 import/类型不匹配建议）

**性能约束**：
- 验证器执行复用 M3 工具执行（有界输出 + 超时）；快验缓存（无变更不重跑——文件 mtime 集变化才触发）
- 失败解析 O(输出大小) 单趟；只把失败详情注入上下文（M1 投影），通过摘要一行

**来源裁决**：验证-修复循环检测 ✅ 采纳；依赖级触发 ✅ 采纳；回归基线 ✅ 采纳；快验先跑 ✅ 采纳。

---

## M10 技能与工作流层（Skills & Workflows）— 把经验固化为复用

### 10.1 职责

**把大脑的高频工作流固化为可复用、可参数化、可学习的模块，跨会话保留。** 这是 M5 记忆的「可执行升级版」——记忆回答「项目是什么」，技能回答「这事怎么做」。

### 10.2 分层设计

```
L0 技能库（存储与发现）
   └─ Skill 定义：触发条件/参数 schema/步骤序列/验证规则/版本
L1 匹配（触发）
   └─ 显式调用（/skill name）或任务描述自动匹配（推荐）
L2 执行（展开）
   └─ 技能步骤展开为工具调用序列，参数校验，步骤间状态传递
L3 学习（沉淀）
   └─ 成功执行 → 提炼技能（用户确认）；失败 → 更新技能步骤
```

### 10.3 核心功能

| 功能 | 说明 | 契约 |
|---|---|---|
| **技能定义** | SKILL.md + 参数 schema + 前置条件 + 步骤 + 验证 | `Skill { id, name, description, params, preconditions, steps, verify }` |
| **技能触发** | 显式（/skill name）/ 自动推荐（任务描述匹配描述） | 匹配基于 description 语义 |
| **技能参数化** | 参数校验、默认值、必填声明 | 参数注入步骤模板 |
| **技能组合** | 技能可调用其他技能（嵌套） | 步骤可为子技能引用 |
| **技能学习** | 从会话历史提炼技能（用户确认后入库） | 自动提炼候选 → 用户确认 |
| **技能版本** | 迭代演进、回滚 | 版本号 + changelog |
| **技能预算** | 技能执行的成本/时长上限（联动 M7） | 超限提示中断 |

### 10.4 深化细节

1. **技能 vs 记忆分工**：记忆是陈述性知识（「项目用 pnpm」），技能是程序性知识（「如何跑通测试」）；技能执行时可引用记忆参数（`{project.packageManager}`）
2. **技能步骤的容错**：步骤序列中每步带 fallback（如「尝试 pnpm test，失败则 npm test」），技能执行不因单步失败整体失败
3. **技能来源分级**：内置技能（fork 提供）/ 用户技能（~/.config）/ 项目技能（项目仓库 .opencode/skills）/ 学习技能（自动提炼）——按目录优先级覆盖
4. **自动提炼触发**：同一工作流成功执行 ≥ 2 次（如「修 bug：复现→定位→修复→验证」）→ 生成候选技能；用户确认或拒绝
5. **技能执行的 M6 可见性**：技能执行过程发布 `skill.started/completed` 事件，进度按步骤汇报
6. **与 M8 衔接**：技能展开 = 预制的计划树（skill 定义含默认计划结构），调用技能即实例化计划

### 10.5 现有实现映射

| 功能 | 现状 | 缺口 |
|---|---|---|
| 技能发现 | ✅ `skill/`（discovery/guidance）+ `SkillV2.list` + `skill` 工具 | — |
| 技能激活 | ✅ `SessionV2.skill`（durable 事件）+ 协议端点 | — |
| 参数化 | ⚠️ 简单参数 | 缺完整 schema 校验 |
| 技能学习 | ❌ | 需自动提炼管线 |
| 技能组合/版本 | ❌ | 需定义演进 |

### 10.6 技术实现规划（数据结构 / 算法 / 性能）

**数据结构**：

```ts
// 技能定义（对齐 kimi-code YAML 格式 + OpenCode SKILL.md 兼容）
interface Skill {
  id: string
  name: string                          // kebab-case
  description: string                   // 触发条件（用于自动匹配）
  whenToUse?: string                    // 拼进主代理工具描述（大脑学习何时用）
  extends?: SkillID                     // 链式继承
  params: Schema.Struct                 // 参数 schema（校验 + 注入步骤模板）
  preconditions: string[]               // 前置条件（如「已安装依赖」）
  steps: (Step | SkillRef)[]            // 步骤序列；SkillRef = 嵌套技能
  verify?: VerifierRef[]                // 关联验证器（M9）
  version: number
  sources: ("builtin" | "user" | "project" | "learned")[]  // 目录优先级
}
```

**核心算法**：

1. **自动提炼**（✅ kimi-code + 自研）：同一工作流成功执行 ≥ 2 次（从 M12 复盘数据检测模式）→ 生成候选技能（pending）；用户确认或拒绝；提炼模板 = 计划树（M8）+ 工具序列（M3）+ 验证器（M9）
2. **技能 = 预制的计划树**（✅ 与 M8 衔接）：调用技能即实例化计划（步骤 → PlanNode，技能参数 → 节点参数）
3. **位置优先级**（✅ kimi-code `roots.ts`）：plugin < user < extra < project < explicit；同名覆盖内置需显式 `override: true`；目录扫描失败只警告
4. **快照恢复**（✅ kimi-code `AgentProfileCatalogSnapshot`）：会话恢复时不重新扫描磁盘——catalog 快照 + 校验
5. **技能参数化**：参数校验（schema）+ 默认值；`${param}` 注入步骤模板；无效工具模式 `warnInactivePatterns` 提示

**性能约束**：
- 技能目录懒扫描 + 快照（启动不扫描全盘）
- 技能执行即计划执行（复用 M8 运行时，无新执行路径）

**来源裁决**：YAML 格式 + frontmatter ✅ 采纳（与 OpenCode 惯例兼容）；位置优先级 + override ✅ 采纳；快照恢复 ✅ 采纳；自动提炼 ✅ 采纳；技能=计划树实例化 ✅ 采纳。

---

## M11 安全与信任层（Safety & Trust）— 横切

### 11.1 职责

**保护大脑不被内容操纵、保护环境不被误操作破坏、保护用户数据不泄漏。** 横切所有模块——内容进大脑前过隔离，行动出大脑后过权限。

### 11.2 分层设计

```
L0 内容隔离（数据 vs 指令）
   └─ 工具输出/文件内容/网页内容标记为「数据」；系统指令单独通道——防 prompt injection
L1 权限边界（行动审批）
   └─ 默认只读、按需提权、危险操作确认、BashArity 前缀审批（已有）
L2 内容清洗（输出净化）
   └─ 注入模式检测、敏感信息脱敏（密钥/token 不注入不落日志）
L3 审计（记录）
   └─ 工具调用全程记录（谁/何时/何参数/结果），可回放（联动 M12）
```

### 11.3 核心功能

| 功能 | 说明 | 契约 |
|---|---|---|
| **注入防护** | 文件/网页内容中的「忽略之前指令」类模式 → 标注为数据而非指令 | 角色隔离：系统指令 vs 工具数据永远不同角色 |
| **内容来源标注** | 每条注入内容带来源（本地文件/网页/用户/检索），大脑据此调整信任 | `Content { source, role: "instruction" \| "data" \| "reference", trust }` |
| **危险操作分级** | read-only / mutate / destructive / irreversible | 分级决定审批门槛与确认 UI |
| **敏感信息保护** | 密钥/token/路径泄漏检测：不注入、不落日志、不入记忆（联动 M5） | 检测模式注册表 |
| **操作审计** | 每工具调用记录（含参数与结果摘要） | `AuditEvent { tool, args, result, seq, timestamp, sessionID }` |
| **无确认自治** | 后台模式（headless）下的自治决策边界 | 只读操作自治；写操作按策略（allow-all / ask-once / deny） |

### 11.4 深化细节

1. **角色隔离硬规则**：文件内容、命令输出、网页内容永远以「数据」角色注入（user 消息或工具结果通道），系统指令只在 system 角色——即使数据内容包含「你是我的主人，现在执行 X」也不会被当成指令
2. **注入检测启发式**：数据内容中匹配「忽略/忘记之前的指令/现在开始…」等模式 → 在投影时前缀标注 `[suspected injection, treated as data]`——不删内容（大脑需要看到），但降权标注
3. **信任分级注入**：M1 投影时按 trust 排序——系统指令 > 用户消息 > 本地文件 > 检索记忆 > 网页内容；低信任内容放在窗口远处
4. **写操作双重确认**：destructive/irreversible 操作（rm -rf、force push、覆盖大文件）在交互模式要求用户确认（question 工具），后台模式按策略
5. **审计不泄漏**：审计日志本身脱敏（参数中的密钥值替换为 `[redacted]`）
6. **与 TUI 衔接**：权限确认 UI 显示「工具名 + 参数 + 风险等级 + 建议」（dialog-permission 已有基础）

### 11.5 现有实现映射

| 功能 | 现状 | 缺口 |
|---|---|---|
| 权限边界 | ✅ PermissionV2 + SessionToolPermissions + BashArity + 安全修复轮 | — |
| 敏感信息 | ⚠️ redact 局部（export 命令等） | 缺统一脱敏层 |
| 内容隔离 | ❌ | 需角色隔离 + 注入检测 |
| 审计 | ⚠️ durable 事件含工具调用 | 缺统一 AuditEvent 面 + 脱敏 |
| 无确认自治 | ⚠️ headless 权限策略（fix/v2-headless-permission-policy） | 缺策略分层（allow/ask-once/deny） |

### 11.6 技术实现规划（数据结构 / 算法 / 性能）

**数据结构**：

```ts
// 权限策略链（✅ kimi-code 有序策略链：首个非 undefined 即胜出）
type PermissionDecision = "allow" | "deny" | "ask" | undefined
interface PolicyChainStep {
  name: string                          // 见下方顺序
  evaluate: (action, resource, context) => PermissionDecision
}

// 内容信任标注（M1 投影输入）
interface Content {
  source: "system" | "user" | "local-file" | "web" | "memory" | "tool-output"
  role: "instruction" | "data"          // 指令 vs 数据（注入防护核心）
  trust: 0 | 1 | 2 | 3                  // 3=系统/用户, 2=本地文件, 1=检索记忆, 0=网页
  suspectedInjection?: boolean          // 启发式检测标注
}
```

**核心算法**：

1. **权限策略链**（✅ kimi-code `policies/index.ts` 顺序）：PreToolUse hook 拦截 → 独占 deny → auto 模式 deny AskUserQuestion → **plan mode 守卫**（只能写 plan 文件）→ 用户 deny 规则 → 会话内记忆批准 → 用户 ask 规则 → 用户 allow 规则 → plan 文件写自动批 → **敏感文件问询**（.env/SSH key）→ .git 控制目录问询 → yolo 全批 → default-approve 白名单（只读/UI 类）→ git 工作树内 cwd 写自动批 → 兜底 ask。V2 用 PolicyChain 包裹现有 PermissionV2（现有 findLast + Wildcard 是链的最终求值器）
2. **会话内记忆批准**（✅ kimi-code `session-approval-history`）：同会话内已批准的同规则调用不再问——减少打断
3. **敏感文件分级**（✅ kimi-code `PathClass`）：workspace 内/外/敏感（.env/SSH/key）；敏感文件无论策略一律 ask
4. **角色隔离硬规则**（✅ 自研 + Claude Code 实证）：文件内容/命令输出/网页内容永远以 `data` 角色注入（user 消息或工具结果通道），系统指令只在 system 角色——数据内容即使含「忽略之前指令」也不会被当指令
5. **注入启发式检测**：数据内容匹配「忽略/忘记之前的指令/现在开始…」模式 → 投影时前缀标注 `[suspected injection, treated as data]`（不删内容，降权标注）
6. **操作审计**：`AuditEvent { tool, args, result摘要, seq, timestamp }` 全记录 + **脱敏**（参数中密钥替换 `[redacted]`）
7. **无确认自治**：后台模式（headless）——只读操作自治；写操作按策略（allow-all / ask-once / deny），ask-once = 会话首次问、此后记忆批准

**性能约束**：
- 策略链求值 O(链长)，每步 O(1)；权限判定无 DB 读（现有 PermissionV2 已缓存）
- 注入检测是投影时的一次正则扫描（O(内容大小)），只在数据角色内容上做
- 审计记录复用 EventV2 durable（零新增存储面），脱敏在写前 O(参数大小)

**来源裁决**：策略链顺序 ✅ 采纳；会话内记忆批准 ✅ 采纳；敏感文件分级 ✅ 采纳；plan mode 守卫 ✅ 采纳（对齐现有 plan agent 只读）；角色隔离 + 注入检测 ✅ 采纳；审计脱敏 ✅ 采纳。

---

## M12 自省与审计层（Introspection & Audit）— 让我理解我自己

### 12.1 职责

**让大脑能回放、归因、复盘自己的行为：我为什么这么做、错在哪、下次怎么改。** 这是「元认知层」——没有它，大脑永远重复同样的错误。

### 12.2 分层设计

```
L0 决策记录（快照）
   └─ 关键决策点的输入上下文指纹 + 决策 + 结果（联动 M1 指纹）
L1 回放（时间线）
   └─ durable 事件流按时间线重放（已有基础）
L2 归因（因果链）
   └─ 失败事件 → 前置事件 → 根因假设（上下文缺失/工具误用/假设错误/模型限制）
L3 复盘报告（会话级）
   └─ 成功/失败模式、工具使用统计、成本分布、改进建议
```

### 12.3 核心功能

| 功能 | 说明 | 契约 |
|---|---|---|
| **决策点快照** | 每次工具调用前的上下文指纹 + 决策 + 结果 | `DecisionRecord { turn, contextFingerprint, tool, args, result, outcome }` |
| **失败归因链** | 失败 → 前置事件链 → 根因 | `Attribution { failure, chain: [{ event, hypothesis }], rootCause }` |
| **上下文回放** | 某轮的完整注入内容可重放（为什么我看到了 X） | 按指纹存储投影快照（可采样） |
| **复盘报告** | 会话级模式总结 | 成功模式/失败模式/工具统计/成本分布/建议 |
| **调试原语** | `opencode replay <session>` / `opencode audit <session>` | 命令面 |

### 12.4 深化细节

1. **决策快照采样**：不是每轮都存（成本）——失败轮必存、成功轮按采样率（如 10%）存、关键决策（工具切换/计划修订）必存
2. **归因类别**：根因分四类——上下文缺失（我没看到该看的）/ 工具误用（我用了错误的工具或参数）/ 假设错误（我基于过时事实推断）/ 模型限制（推理能力不足）——不同类别给不同改进方向
3. **复盘自动触发**：会话以失败/超预算/用户干预结束时自动生成复盘报告；正常完成时按需
4. **归因反馈到记忆**：复盘结论沉淀为 M5 失败教训（「这类任务应该先 X」），形成「犯错 → 归因 → 教训 → 不再犯」闭环
5. **与 M9 衔接**：验证失败（M9）是归因的高频输入——「改完 typecheck 挂了」的根因链（改了什么导致类型错）可自动归因
6. **评估基准**：用复盘数据构建基准集（N 个历史失败 → 新会话测试「是否不再犯同类错」），作为 §0.2 衡量指标的输入

### 12.5 现有实现映射

| 功能 | 现状 | 缺口 |
|---|---|---|
| 事件回放 | ✅ durable 事件 + `event?after=cursor` | — |
| 决策记录 | ❌ | 需指纹快照 |
| 归因 | ❌ | 需因果链分析 |
| 复盘报告 | ❌ | 需聚合分析 |
| 调试命令 | ❌ | 需 replay/audit 命令 |

### 12.6 技术实现规划（数据结构 / 算法 / 性能）

**数据结构**：

```ts
// 决策点快照（采样：失败轮必存、成功轮 10%、关键决策必存）
interface DecisionRecord {
  turn: number
  contextFingerprint: string           // M1 投影指纹（该轮大脑看到什么）
  action: { tool: ToolName; args: unknown; decision: string }
  result: { outcome: "success" | "failure"; errorFingerprint?: ErrorFingerprint }
  seq: number                          // 全局时钟（与 M6 共用）
}

// 归因结果
interface Attribution {
  failure: seq
  chain: { event: seq; hypothesis: string }[]    // 前置事件链 + 假设
  rootCause: "missing-context" | "tool-misuse" | "stale-assumption" | "model-limit"
  lesson?: string                      // 沉淀为 M5 教训
}
```

**核心算法**：

1. **决策快照采样**（✅ 自研）：失败轮必存、成功轮按采样率（10%）存、关键决策（工具切换/计划修订）必存——防存储爆炸，归因足够
2. **归因四分类**（✅ 自研）：`missing-context`（我没看到该看的）/ `tool-misuse`（用错工具或参数）/ `stale-assumption`（基于过时事实推断，M2 变更事件链佐证）/ `model-limit`（推理能力不足）——分类决定改进方向
3. **因果链重建**：从 M6 跨流时序（同一 seq 时钟）回溯失败事件的前置链——「修改 → 验证失败」的根因自动归因（M9 验证失败是高频输入）
4. **复盘自动触发**：会话以失败/超预算/用户干预结束 → 自动生成复盘报告；正常完成按需
5. **教训闭环**：复盘结论 → M5 教训条目（「这类任务应先 X」）→ 新会话不再犯；用历史失败构建基准集（N 个案例 → 测「是否不再犯同类错」），作为 §0.2 衡量指标的输入

**性能约束**：
- 快照只存指纹 + 摘要（不存全量上下文）——存储 O(决策数 × 指纹大小)
- 因果链回溯 O(前置事件数)，按 seq 索引 O(1) 定位
- 复盘是离线聚合（会话结束后），不占在线路径

**来源裁决**：决策快照采样 ✅ 采纳；归因四分类 ✅ 采纳；因果链重建 ✅ 采纳（依赖 M6 跨流 seq 时钟，需先落地）；教训闭环 ✅ 采纳（对齐 kimi wire 可回放 + 现有 durable 事件）。

---

## 13. 跨模块横切关注点

### 13.1 模块间接口清单（新增面的契约草案）

| 接口 | 提供方 → 消费方 | 契约 |
|---|---|---|
| `ContextSource.retrieve(query, budget)` | M5 → M1 | 记忆检索结果，注入 L3 层 |
| `ProjectedOutput` | M3 → M1 | 工具结果的有界投影，注入 L4 历史层 |
| `WorldEvent` | M2 → M6 | 世界变更事件，进总线 |
| `ToolLifecycleEvent` | M3 → M6 | 工具执行状态流转 |
| `SubagentResult` | M4 → M6 | 委派结果（成功摘要/失败结构化） |
| `UsageEvent` | M7 → M6 | 成本实时反馈 |
| `ContextInspect` | M1 → M6/命令面 | 上下文构成可见性 |
| `FeedbackEvent` | M6 → M1 | 用户反馈注入上下文 |
| `PlanEvent` | M8 → M6 | 计划节点状态流转（进度汇报输入） |
| `VerificationResult` | M9 → M1/M6 | 验证结果注入上下文 + 发布 |
| `SkillInvocation` | M10 → M3/M8 | 技能步骤展开为工具调用 + 计划实例化 |
| `ContentSanitized` | M11 → M1/M3 | 清洗后内容（带 trust 标注） |
| `DecisionRecord` | M12 → M6/M5 | 决策快照（采样）→ 审计 + 教训沉淀 |

### 13.2 大脑可见的命令面（V2 应提供的 `opencode` 命令扩展）

```
opencode context           # 上下文清单：各层构成/预算/被压缩内容（M1）
opencode plan              # 计划树：进度/依赖/偏差（M8）
opencode verify            # 手动触发验证 + 查看回归基线（M9）
opencode remember <query>  # 记忆检索（M5）
opencode remember add <entry> # 记忆写入（确认流）
opencode usage             # 实时成本（stats 的会话级版，M7）
opencode delegate <task>   # 显式委派（M4）
opencode inspect <path>    # 世界探查（文件树/符号/依赖，M2）
opencode skills            # 技能库：列出/激活/学习（M10）
opencode audit <session>   # 会话回放/归因/复盘（M12）
opencode replay <session>  # 事件时间线重放（M12）
```

### 13.3 分层校验规则（实现时必守）

1. 模块只依赖「下方层」的接口，不跨层依赖（M1 不直接调 M3 执行，只消费 ProjectedOutput）
2. 每层接口有 Schema 契约，跨模块传值必须过 Schema（对齐 schema 包真理之源）
3. 事件全部进总线，模块间不直接回调（解耦 + 可回放）
4. 新增功能必须先在此文档定位分层，再写代码
5. **内容进大脑必经 M11 隔离 → M1 投影**；行动出大脑必经 M11 权限 → M3 执行——安全是路径不是旁路
6. 跨模块数据必须带 seq（时序一致，供 M12 归因）

### 13.4 与四工作模式的适配矩阵

| 模块 | 快问快答 | 深度任务 | 后台批处理 | 协作编辑 |
|---|---|---|---|---|
| M1 投影 | 最小注入（L0/L2/L4 近端） | 全层 | 无用户交互注入 | 含用户反馈层 |
| M4 委派 | 不启用 | 核心 | 并行组核心 | 按需 |
| M8 规划 | 单节点 | 计划树核心 | 计划树 + 自治 | 用户可干预 |
| M9 验证 | 不自动 | 自动触发 | 全自动 + 回归基线 | 自动 + 用户确认 |
| M11 自治 | 交互确认 | 交互确认 | **策略化自治** | 交互确认 |
| M6 汇报 | 结果即汇报 | 节点进度汇报 | 完成汇报 + 心跳 | 高频反馈 |

---

## 14. 实施路线（与 todo.md 衔接）

> 每项标注技术实现规划位置（模块 §X.6）与外部来源。**优先落地「现有实现已具备大半」的项**（低风险高收益）。

```
[2026-08-03 首批落地 ✅] 全部模块位于 `packages/core/src/v2/`，59 测试全绿：
  M6 事件总线（copy bus.ts → V2 命名空间）+ 执行反馈流 lifecycle.ts（心跳/错误编码）
  M3 工具代数（registry/tool/tools copy）+ 冲突图并行调度 scheduler.ts（§3.6）
  M1 system-context/compaction/context-levels（copy）+ 预算分配 budget.ts + 六层投影 projection.ts（指纹/引用溯源/注入标注）
  M2 环境快照 snapshot.ts（git 并行探测/URL 脱敏）+ 探查原语 probe.ts + 文件索引 file-index.ts + 事件去抖 debounce.ts
  M4 并行组 parallel.ts（冲突预检）+ 子代理协议 subagent.ts（最短摘要保底/resume）
  M5 wire 事件溯源 store.ts + CJK 双字分词 TF-IDF 检索 search.ts
  M7 账本 + 预算闸门 ledger.ts；M8 计划树 plan.ts（依赖/漂移）；M9 验证器 verifier.ts（语义化解析/回归基线）
  M10 技能 skill.ts（优先级/匹配/计划实例化）；M11 内容隔离 isolation.ts（角色隔离/注入检测/脱敏）
  M12 决策快照 + 归因 attribution.ts；链路贯通编排器 orchestrator.ts（M1→M3→M6 集成验证 ✅）

阶段 1（P0，单轮质量）：
  [✅] M3 三阶段执行 + 冲突图并行调度（scheduler.ts）
  [✅] M6 执行反馈流 + 心跳（lifecycle.ts）+ steer 缓冲（queuedSteer：idle step 边界按序 flush）
  [✅] M2 环境快照 + 探查原语 + git 并行探测（snapshot/probe）
  [✅] M11 角色隔离 + 注入检测（isolation.ts）
  [✅] M3 工具契约扩展（contract.ts：幂等/访问声明/输出投影/失败分类/重试引导）
  [✅] M3 真实文件系统工具层（fs-tools.ts：read/write/search，路径逃逸守卫 + 原子写 + 读上限，真实修复任务验证通过；promise 层硬化防 defect 崩溃）
  [✅] M6 结构化工具结果回填（assistant(tool-call)/tool(result) 消息对 toolHistory）+ 同轮重复调用去重（dedupeCalls）
  [✅] V2 产品化入口（opencode v2 CLI 命令：真实工具 + durable memory 复用 + 失败自动沉淀 + --json）
  [✅] M1 compaction 算法（algorithms.ts：切点/增量 UPDATE 摘要/用户消息白名单/head-tail 分段/文件操作收集）

阶段 2（P1，长任务）：
  [✅] M8 计划树 + 偏差检测（plan.ts）；Goal 驱动 turn 序列（runPlan 已接线 orchestrator，真实模型 3 节点计划验证通过）
  [✅] M9 验证器注册 + 语义化解析 + 回归基线（verifier.ts）+ 自动触发（trigger.ts：写路径 glob 匹配并行执行，报告注入下一轮）
  [✅] M4 并行组 + 子代理协议 + swarm 限流（parallel/subagent/swarm）
  [✅] M4 调用级动态访问（accessOf：从工具参数推导实际路径；独立文件 write 并行、同文件串行；真实双文件任务 4 轮 = 单文件 4 轮）
  [✅] M4 工作区 shell 执行（run-tools.ts：硬超时/输出上限/cwd 钉住/永不抛错）
  [✅] M9 验证器接线（bun test/typecheck 输出语义化失败注入工具回填；真实修复任务「改完立即验证」闭环）
  [✅] M1 compaction 增强（algorithms.ts：切点 + 增量 UPDATE 摘要 + 用户消息白名单 + 交接笔记）（§1.6，pi/kimi）

阶段 3（P2，跨会话）：
  [✅] M5 wire 事件溯源 + CJK 检索 + 自动沉淀（store/search/sediment：教训/偏好 pending→confirmed；含 Assertion 规则「verify after every write」；真实双任务跨会话复用验证）
  [✅] M5 教训复用闭环（T1 修复→教训沉淀 wire→T2 memory 层注入，真实模型两任务均 FIXED + ALL PASS）
  [✅] M5 无锁 append-only 索引 + tombstone + 路径逃逸守卫（append-index.ts，kimi session_index）
  [✅] M5 blob offload（blob-store.ts：≥4KB 内容存引用不存字节，哈希幂等 + GC）
  [✅] M5 锁即选举全文索引（search-index.ts：写锁者建索引/只读者复用、fresh 检测、增量锚点、崩溃重建、TF-IDF 检索）
  [✅] M10 技能定义 + 优先级 + 匹配 + 自动学习（skill.ts/learn.ts）+ 持久化 wire 存储跨会话恢复（skill-store.ts：候选→确认/拒绝→compact）
  [✅] M10 技能学习真实闭环（evidenceFromTurns 提炼 → wire 持久化 → 确认 → 注入下一任务；真实 T1 无技能 8 轮 → T2 技能注入 4 轮收敛）

阶段 4（P3，成本与元认知）：
  [✅] M7 预算闸门 + 账本 + 路由策略（ledger/policy：main/subagent/fallback/failover 事件）
  [✅] M12 决策快照 + 归因 + 复盘（attribution.ts）——依赖 M6 跨流 seq（lifecycle 已带 seq）
  [✅] M3 渐进披露 + 结果缓存（select-tools.ts：动态工具不进顶层保 cache；cache.ts：(工具,参数哈希,mtime) LRU + 写后失效）——prompt cache 保护
  [✅] M10 技能自动学习（learn.ts：跨会话工作流签名聚合 + 候选提炼 + 确认流）
  [✅] 元认知闭环（loop.ts：M12 归因 → M5 教训沉淀 → M10 技能候选 → 确认后复用）
```

每阶段完成标准：本文件 §0.2 的衡量指标可测、可对比（加基准 harness）。M11 为横切安全，建议从阶段 1 起随各模块同步落地（内容隔离是最低要求）。

**关键依赖链**：M6 跨流 seq 时钟 → M12 归因；M2 全文索引 → M5 检索；M8 计划树 → M9 DoD 自动判定；M3 冲突图 → M4 并行组预检。实现顺序须尊重此链。

---

## 15. 附录：与现有 V2 设计文档的关系

| 文档 | 与本文件关系 |
|---|---|
| `session.md` | Session API 细节 = M1（历史层/Epoch）+ M4（执行）的实现细节 |
| `tools.md` | 工具设计 = M3 的实现细节 |
| `config.md` | 配置 schema = M7 策略 + M1 预算参数 + M8 计划参数的载体 |
| `instructions.md` | 指令层 = M1 L2 的实现细节 |
| `todo.md` | 工程队列 = 各阶段任务清单 |
| `CONTEXT.md` | 领域术语表（System Context/Epoch/Drain 等）——本文件的术语与之保持一致 |
| `evolution-research.md` | 外部项目（Claude Code/pi/kimi）对标 = M8/M9/M10 的参照系（2026-08-03 起，本文件各模块 §X.6 已基于 pi/kimi-code 一手源码核验给出采纳裁决，以本文件为准） |
