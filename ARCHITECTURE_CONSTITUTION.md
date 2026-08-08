# ARCHITECTURE_CONSTITUTION.md

> **地位**：本文件是 opencode-x 项目**唯一**的软件架构设计说明书（SSOT）。它同时是：架构设计文档、开发规范、包设计规范、模块设计规范、AI Coding Constitution、项目宪法、长期演进规范。
> **使用**：新增 Package/Module/Feature、重构、Code Review、AI Coding（任何模型与工具），一律只引用本文件。
> **禁止**：维护任何其他设计文档（architecture-*.md、runtime.md、workflow.md、provider.md、memory.md、prompt.md、tool.md、design.md、notes.md、draft.md、idea.md、todo.md、xxx-design.md）。设计补充与变更直接修改本文件（§4.1 治理流程）。
> **唯一核心产物**：`README.md`（项目入口）、`AGENTS.md`（AI 工作方式）、本文件（唯一架构事实来源）。
> **版本**：v-final 1.0（定稿 · 2026-08-07 · 前身 ARCHITECTURE_CONSTITUTION.md v1 收敛升级；所有既有分析/设计/裁决合并于此，无重新分析、无重新设计）。

---

## 0. 总则

### 0.1 先收敛，后实现

> 未完成上一级（项目级 → 包级 → 模块级）的设计收敛，不得进入下一级实现；未完成当前 Package 的宪法定义，不得开始实现该 Package；未完成当前 Package 的实现 + 测试 + 文档 + 验收，不得开始下一个 Package。任何实现不得依赖未来补充、TODO 或后续重构达成完整性。

执行形态（严格瀑布式）：

```
Project → Package → Module → Implementation → Review → Acceptance → Next Package
```

禁止跳步骤；禁止多个 Package 同时开发；禁止跳级实现。

### 0.2 收敛优先于扩张（Convergence First）

任何新增（Package/Module/Interface/Hook/Event/Pipeline/Registry/生命周期/文档/配置/抽象）必须证明：

1. 当前架构确实无法承载；
2. 长期收益明显大于维护成本；
3. 不会增加系统复杂度；
4. 不会造成新的设计重复。

否则优先删除、合并、复用、扩展，而不是新增。优先级：

```
Delete > Merge > Reuse > Extend > New
```

### 0.3 架构目标

整个项目长期保持：Stable（稳定）、Consistent（一致）、Maintainable（可维护）、Extensible（可扩展）、Evolvable（可演进）、Testable（可测试）、Observable（可观测）、High Performance、Low Coupling、High Cohesion、Zero Technical Debt。任何设计必须服务于以上目标。

### 0.4 AI Engineering Execution Protocol（AI 开发执行协议）

任何任务（无论大小）必须按序执行，禁止直接修改代码、禁止看到需求立即创建新文件/新包/新抽象：

```
Requirement Understanding
    ↓
Repository Analysis
    ↓
Architecture Constitution Check（对照 §1-§13）
    ↓
Existing Capability Search（§0.5 四问）
    ↓
Impact Analysis（影响面/消费方/兼容性）
    ↓
Design Decision
    ↓
ADR Update（重大决策，§1.16/§4.2）
    ↓
Implementation
    ↓
Testing（§11）
    ↓
Observability Integration（§6.9）
    ↓
Review（§4.7 Self Review）
    ↓
Acceptance（§1.15 DoD）
```

每步必须产出可验证结果（分析结论/裁决/测试/接入证据），缺步即回退。

### 0.5 Codebase Understanding Protocol（代码库理解协议）

新增/修改功能前，必须按链分析：

```
Project Structure → Package → Module → Existing API → Existing Pattern → Existing Test → Existing Observability → Existing Configuration
```

必须回答四问：
1. 是否已有能力可以复用？
2. 是否可以扩展已有模块？
3. 为什么需要新增？
4. 是否违反 Package Boundary（§1.8/§2）？

已有实现：优先修改已有实现，禁止重复建设（P2 一份实现）。

### 0.6 Pragmatic Engineering Rule（工程现实约束）

- 架构服务于业务，不是业务服务于架构。
- 禁止为了理论完整性增加：无意义抽象、无意义 Package、"未来可能使用"的能力。
- 简单方案可以解决时，优先简单方案（与 §4.3 Complexity Budget 联动）。
- 本阶段之后的任何新增设计，必须能通过 §0.2 四项证明；通不过的，一律删除、合并、复用或扩展，而非新增。

---

## 1. Project Constitution（项目级宪法）

### 1.1 项目目标

opencode-x = CLI/TUI 聚焦 fork（官方 opencode v1.18.x 基线，V2 架构主轴）。第一性原理：**LLM 是唯一核心消费方**——架构的全部价值 = 大脑的感知（注入什么）与行动（能调什么）。V2 主轴：SessionV2 状态机 + EventV2 事件溯源 + LLM Protocol 四参数管线。

### 1.2 设计原则

每条原则：定义 → 为什么 → 违反导致 → 如何检查。

| # | 原则 | 定义 | 为什么 | 违反导致 | 如何检查 |
|---|---|---|---|---|---|
| P1 | 单向依赖 | 依赖只沿 schema→core/protocol→server→组合根 方向 | 依赖反转 = 架构漂移起点 | 循环依赖、无法独立测试 | `rg "from \"@opencode-ai/(core\|server\|opencode)\"" packages/{schema,protocol,llm}` 必须为空 |
| P2 | 高内聚 | 一个域的全部逻辑在一个模块/包内 | 职责分裂导致双轨实现 | 同一能力两份实现 | §3 模块表一能力一行 |
| P3 | 低耦合 | 包间只通过公开 API 通信 | 内部暴露 = 隐性契约 | 任意改动波及下游 | 包公开面 = package.json exports |
| P4 | 插件优先 | 能力扩展优先走 plugin 面 | 核心面每加扩展 = 维护债 | 核心膨胀 | 新能力先对照 §1.11 |
| P5 | Interface First | 先锁接口签名，后写实现 | 实现先行 = 接口漂移 | 组装期反复改签名 | 骨架阶段 typecheck 过；实现期禁改签名 |
| P6 | Composition > Inheritance | 组合优先 | 继承链难测试难演进 | God Class 蔓延 | Code Review 对照 §1.13 |
| P7 | Event Driven | 会话状态变化以 EventV2 事件表达 | 事件溯源 = 可重放可审计 | 状态直写、无法 replay | 会话写路径必须发事件 |
| P8 | Dependency Injection | 服务经 Effect Layer 注入 | 隐式依赖 = 不可测 | 测试靠 Mock | §1.13 禁全局单例/直接 new |
| P9 | Immutable Context | System Context / Session History 构建后只读 | 可变上下文 = 注入漂移 | 模型看到不一致上下文 | 上下文构建路径无 setter |
| P10 | Explicit Lifecycle | 一切资源有明确创建/销毁 | 隐式生命周期 = 泄漏 | 进程悬挂、资源泄漏 | 服务有 layer + Scope 释放 |
| P11 | Streaming First | 输出路径默认流式（`llm.stream`） | 流式 = 低延迟 + 可中断 | 整包响应、无法中断 | runner 每轮恰好一次 `llm.stream` |
| P12 | AI Native | 一切设计先回答"大脑获得什么能力" | 架构服务于 LLM 消费方 | 功能自嗨、无人消费 | 模块职责可映射到感知/行动 |
| P13 | Convention over Configuration | 约定优先、配置兜底 | 配置泛滥 = 组合爆炸 | 配置与代码双维护 | 新增配置项需在本文件登记 |

### 1.3 包设计原则

每个 Package：**必须**负责一个领域、拥有明确边界、拥有公开 API、拥有生命周期、可以独立测试、可以单独发布（如适用）；**不得**直接操作其它 Package 内部实现、跨层访问、出现循环依赖、暴露内部对象。
为什么：包边界是依赖规则的物理载体；破坏包边界 = 依赖图失去约束力，独立测试与发布立刻失效。

### 1.4 模块设计原则

每个模块：**必须**职责唯一、依赖显式、可独立测试；**禁止**God Object / God Service、Utils 泛滥、跨模块共享状态、隐藏依赖、隐式 Side Effect。
为什么：模块是验收的最小单元（§1.15）；职责模糊的模块无法判断"完成态"。

### 1.5 整体架构与分层

```
┌─────────────────────────────────────────────────┐
│ opencode  组合根/CLI（run/serve/attach/tui/init） │
├──────────────┬──────────────────────────────────┤
│ tui    UI 层  │ server   HTTP 组装（零领域实现）  │
├──────────────┴───────┬──────────────────────────┤
│ core   领域内核（会话/事件/工具/权限/配置唯一实现处）│
├──────────────────────┼──────────────────────────┤
│ llm   模型层          │ protocol  HTTP 协议契约    │
├──────────────────────┴─────────┬────────────────┤
│ schema  契约层（唯一数据形状来源）│ plugin 插件 API  │
├─────────────────────────────────┴────────────────┤
│ effect-drizzle-sqlite  基础设施     codemode  独立工具 │
└──────────────────────────────────────────────────┘
```

### 1.6 Monorepo 规划与目录结构

13 包（禁止新增包，除非通过 §1.8 门禁 + ADR）：

```text
packages/
├── schema            契约层（零工作区依赖）
├── protocol          HTTP API 契约（→ schema）
├── llm               模型层（→ schema）
├── observability     横向观测层（→ schema；供 core/llm/server/opencode/tui 注入，ADR-013）
├── core              领域内核（→ llm/schema/plugin/effect-drizzle-sqlite）
├── server            HTTP 服务组装（→ core/protocol/schema）
├── plugin            插件 API（→ sdk）
├── opencode          组合根/CLI（→ 全部）
├── tui               终端 UI（→ core/plugin/sdk）
├── sdk/js            客户端生成面（生成期 → schema/protocol）
├── codemode          独立工具（零工作区依赖）
├── http-recorder     开发工具（零工作区依赖）
└── effect-drizzle-sqlite  基础设施（零工作区依赖）
```

### 1.7 生命周期宪法

- **包级**：无状态包（schema/protocol）无生命周期；有状态包（core/server/opencode）以 Effect Layer 生命周期为准（初始化 → 运行 → Scope 释放）。
- **模块级**：模块生命周期 = 服务 layer + Scope；禁止隐式启动。
- **会话级**：Session = 创建（prompt 准入）→ 运行（drain/turn 循环）→ 归档/删除；EventV2 全程溯源。
- **资源**：一切外部资源（进程/文件 watcher/pty/连接）必须有显式释放路径（acquireRelease/finalizer）。
- **升级**：Session 数据模型演进走 wire schema version（`session.next.wire.schema.version.changed`）。

### 1.8 依赖规则（唯一）

领域依赖链（单向，禁止逆向/跨层/循环）：

```
CLI（组合根 opencode）
   ↓
Runtime（core/execution）
   ↓
Session（core/session）
   ↓
Workflow（core/planning）
   ↓
Planner（core/planning 内域，ADR-001）
   ↓
Memory（core/memory + system-context）
   ↓
Prompt（core/system-context）
   ↓
Tool（core/tool）
   ↓
Provider（llm）
   ↓
Transport（protocol/schema 契约 + server HTTP）
```

包级约束：
- schema 零依赖；protocol/llm 只依赖 schema；core 依赖 llm/schema/plugin/effect-drizzle-sqlite；server 依赖 core/protocol/schema；tui 依赖 core/plugin/sdk；opencode 依赖全部（组合根）；client 运行时代码（sdk）永不依赖 core/server。
- **observability（ADR-013）**：横向观测层，只依赖 schema；core/llm/server/opencode/tui 可依赖 observability（观测注入，不参与领域依赖方向）。观测依赖禁止反向（observability 永不依赖任何业务包）。
- **新增 Package 门禁**：必须满足本条依赖链 + 通过 §0.2 四项证明 + ADR，否则禁止创建。

### 1.9 性能原则

- 流式优先：输出路径默认流式；禁止整包阻塞。
- 上下文预算：注入的每个 token 都是预算 → 投影分层 + 预算分配 + 压缩（compaction 阈值 / ContextLevels L1-L5）。
- 每轮 provider 调用恰好一次 `llm.stream`；禁止重复构建历史。
- 事件持久化批写；bus 轻量。
- TUI 渲染不阻塞会话循环。
- 回归以 core 测试基线与运行基准为准，批次验收时对比。

### 1.10 安全原则

完整安全边界与权限模型见 **§10 Security Constitution**。要点：内容进大脑过 isolation → projection；行动出大脑过 permission → tool（双向管道纪律）；高风险能力必须经过 Permission Check，禁止默认无限权限（最小权限原则）。

### 1.11 扩展原则（新能力定位裁决，写代码前必答）

1. 大脑能力 → core 域（先在本文件定位分层再动手）
2. 神经传输 → llm（protocols/providers）
3. 契约 → schema + protocol（§3.5 新契约登记）
4. 呈现 → tui（单存储收敛后的纯转换）
5. 编排 → opencode（组合根，不写第二实现层）
6. 插件面 → plugin v2/effect
其余一律不进包体系（介质包不新增）。

### 1.12 演进原则

- **只增、只扩、只换实现**：禁止破坏 Package 边界、生命周期、依赖关系、接口规范。
- 任何重构必须保持本宪法条款不变；条款变更 = 走 §4.1 治理流程（先改本文件，再改代码，登记消费方）。
- sync 上游：merge-clean 按 fork 删留清单重删；上游新机制先对抗审计（正确性 > 完整性 > 性能 > 可维护性 > 精简）。

### 1.13 Coding Rules

- 遵守仓库 `AGENTS.md` 风格条款（命名、destructuring、imports、控制流、schema 定义、测试、typecheck 命令）。
- 服务依赖显式注入（P8）：禁止 `globalThis.*`；测试不 Mock 真实服务（唯一例外需 ADR）。
- 一个能力一份实现（P2）：发现双轨实现立即归并。
- 不用 `any`；类型收窄靠 type guard。
- 文件 >700 行即违反职责唯一（拆分任务见 §3）。

### 1.14 Implementation Rules（零技术债）

进入主干的代码禁止出现：`TODO` / `FIXME` / `HACK` / `TEMP` / `PLACEHOLDER` / `STUB` / `Pending` / "Future Work" / "Will Implement Later" / Empty Implementation / Mock（主干内）。
任何模块进入主干必须达到可工作的完成态。提交前 `rg "TODO|FIXME|XXX|STUB|HACK" <改动文件>` 必须为空。

### 1.15 Definition of Done

**Package DoD**（13 项全满足才可进入下一包）：
架构设计完成 / API 设计完成 / 生命周期完整 / 模块划分稳定 / 通信方式明确 / 配置体系完整 / 错误处理完整 / 日志完整 / Metrics 完整 / Tracing 完整 / 测试方案明确 / 文档同步完成 / **Observability 接入完整**（Logger + Trace + Metric + Error Capture + Performance Timer，§6.9）。

**Module DoD**（5 项全满足才可进入下一模块）：
设计完成 → 实现完成 → 测试完成 → Review 完成 → 文档完成。

任何技术债不得向后传递、不得依赖未来重构、不得"以后补"。

### 1.16 Architecture Decision Record（ADR）

重大架构决策统一记录 ADR。格式：

```text
ADR-NNN 标题
状态：Accepted（最终方案定稿）
背景：为什么需要此决策
决策：最终方案（正文唯一保留）
放弃方案：放弃的方案与原因
影响：边界 / 消费方 / 后续约束
```

已定 ADR 明细见附录 A。**正文只保留最终方案**，设计历史统一维护在 ADR。

---

## 2. Package Constitution（包级宪法）

### 2.1 统一模板（所有包，禁止特殊处理）

```text
Package <name>
- 职责 / 设计目的：……（一句话）
- 边界：拥有的能力域 / 不属于本包的
- 生命周期：包级初始化/销毁约定（或"无状态"）
- 依赖关系：工作区依赖（§1.8）
- 公开 API：唯一导出面
- 配置：配置项与归属
- 事件：发布/订阅的事件契约
- 扩展点：允许下游扩展的钩子
- 性能要求：延迟/内存/体积指标
- 测试要求：测试策略与基线
- 日志 / Metrics / Tracing：观测要求
- 错误处理：错误类型与失败分类
- 禁止事项：不得 import 谁 / 不得含什么
- 未来演进：已裁决方向（ADR）
```

### 2.2 schema `packages/schema`

- 职责/目的：契约层，跨包数据形状唯一来源；浏览器安全。
- 边界：仅契约 + 编解码；无业务逻辑、无 IO、无 Effect。
- 生命周期：无状态。
- 依赖：无（零工作区依赖）。
- 公开 API：`Schema.*` 命名空间投影。
- 配置：无。
- 事件：无（定义事件契约但不发布）。
- 扩展点：新契约登记（§3.5）。
- 性能：可序列化、可 tree-shaking。
- 测试：契约形状、identifier 唯一稳定、optional 省略语义、无意外 Any。
- 日志/Metrics/Tracing：无。
- 错误处理：编解码失败由 schema 机制表达。
- 禁止：业务逻辑；依赖任何工作区包；当前契约 `Schema.Any`。
- 演进：V2 前缀清理完毕（identifier 去 V2）；TokenCounts 组合子替换 4 处重复账本（session Info / message / step Ended / turn Ended）。

### 2.3 protocol `packages/protocol`

- 职责/目的：HTTP API 契约（HttpApi）与事件桥协议。
- 边界：仅契约定义，无实现逻辑。
- 生命周期：无状态。
- 依赖：schema。
- 公开 API：v1/v2 双端点定义。
- 配置：无。
- 事件：事件桥协议定义。
- 扩展点：新端点契约登记。
- 性能：契约生成面轻量。
- 测试：端点契约与 SDK 生成面一致。
- 日志/Metrics/Tracing：无。
- 错误处理：契约错误码定义。
- 禁止：依赖 core/server。
- 演进：`/message` 单数端点维持（ADR-005，deferred 至 mini replay V2 化）。

### 2.4 llm `packages/llm`

- 职责/目的：模型层。LLM Protocol 实现 + provider 适配 + TokenCounts 消费。
- 边界：无会话/事件逻辑。
- 生命周期：无状态（client 工厂由调用方管理）。
- 依赖：schema。
- 公开 API：`llm.stream` 单一入口、`LLMClient`、provider 工厂。
- 配置：provider 配置（模型/密钥来源）。
- 事件：LLM 事件流（`LLMEvent`）。
- 扩展点：新 provider 走统一协议。
- 性能：流式低延迟；每轮恰好一次 `llm.stream`。
- 测试：provider 录制测试、流式事件序列测试。
- 日志/Metrics/Tracing：provider 调用 span（`LLMClient` 内建）。
- 错误处理：统一 `LLMError` 分类（超时/限流/协议）。
- 禁止：依赖 core；未标注的 dead 门面。
- 演进：协议拆分三区（接口/实现/配置，P2.6）；DESIGN 移出 src；统一映射 `LLM.Usage`。

### 2.5 core `packages/core`

- 职责/目的：领域内核。V2 会话/事件/工具/权限/配置唯一实现处。
- 边界：无 HTTP/CLI/TUI 呈现；v1 兼容 4 处只读（ADR-006）。
- 生命周期：服务 Layer + Scope；SessionExecution 进程全局、Session ID 定位。
- 依赖：effect-drizzle-sqlite、llm、schema、plugin。
- 公开 API：SessionV2 服务、EventV2 溯源、工具注册表、权限裁决、配置装载。
- 配置：config 域（装载/迁移/校验）。
- 事件：EventV2 全量事件契约。
- 扩展点：SessionHooks、工具注册、context source 注册表。
- 性能：投影/压缩延迟约束；事件持久化批写。
- 测试：模块单元 + 会话集成（311 文件基线，不降基线；不 Mock 真实服务）。
- 日志/Metrics/Tracing：模块级观测三件套（观测域统一）。
- 错误处理：模块级错误类型 + 失败分类（C4 ACI 审计）。
- 禁止：import opencode/tui/server/codemode；扩展 v1 兼容引用。
- 演进：包壳 + 域接口化（显式化 event/storage/security/provider/tool 出口接口，不动文件位置，ADR-007）；Memory L1-L5、Prompt Framework、Workflow DAG 均 core 内域（ADR-001）。

### 2.6 server `packages/server`

- 职责/目的：服务层。HTTP 服务器组装（HttpApi），零领域实现。
- 边界：路由注册、事件桥（进程内嵌）、cursor 收敛。
- 生命周期：随组合根启动/关闭。
- 依赖：core、protocol、schema。
- 公开 API：HttpApi 路由面。
- 配置：端口等服务配置。
- 事件：事件桥（进程内嵌）。
- 扩展点：协议端点唯一来源。
- 性能：端点收敛（P2.4 拆分）。
- 测试：httpapi 端点集成测试。
- 日志/Metrics/Tracing：请求观测。
- 错误处理：契约错误码。
- 禁止：领域逻辑；import opencode/tui。
- 演进：端点收敛到 protocol 契约。

### 2.7 plugin `packages/plugin`

- 职责/目的：插件 API 层。第三方插件唯一入口。
- 边界：plugin v2（`src/v2/`）；v1 出口（index/shell/tool/tui）退役评估中。
- 生命周期：插件加载/运行/卸载三节律。
- 依赖：sdk。
- 公开 API：v2 插件生命周期 API。
- 配置：插件配置协议。
- 事件：插件事件契约。
- 扩展点：插件工具/钩子。
- 性能：加载开销有界。
- 测试：v2 插件生命周期示例测试。
- 日志/Metrics/Tracing：插件调用观测。
- 错误处理：插件错误隔离（不拖垮宿主）。
- 禁止：依赖 core/server/opencode；只面向 sdk 类型。
- 演进：v1 出口收窄或冻结标注，随 v1 栈退役删除。

### 2.8 opencode `packages/opencode`

- 职责/目的：组合根。CLI 入口、进程组装、应用层。
- 边界：cli 命令（run/serve/attach/tui/init/v2）、组合根接线、httpapi v1 端点（退役中）。
- 生命周期：进程生命周期 = 组合根生命周期。
- 依赖：codemode、llm、plugin、protocol、schema、sdk、server、tui。
- 公开 API：CLI 命令面。
- 配置：CLI 参数、config 装载。
- 事件：订阅 core 事件流。
- 扩展点：无（编排面，不写第二实现层）。
- 性能：启动开销有界。
- 测试：cli 集成、httpapi 全绿。
- 日志/Metrics/Tracing：组合根观测。
- 错误处理：命令失败分类。
- 禁止：新增领域逻辑；v1 栈只减不增。
- 演进：P1.1 删 v1 工具表；P1.2 删 processor/ai-sdk（native 唯一）；P1.3 删 prompt.loop；v1 运行栈（session/ 22 文件）随端点退役删净。

### 2.9 tui `packages/tui`

- 职责/目的：终端 UI 层。纯渲染 + 单存储。
- 边界：无领域逻辑；不直接调 provider。
- 生命周期：随组合根启动/关闭。
- 依赖：core、plugin、sdk。
- 公开 API：TUI 入口与视图。
- 配置：UI 偏好。
- 事件：订阅 core EventV2。
- 扩展点：视图注册。
- 性能：渲染不阻塞会话循环。
- 测试：视图快照/行为测试。
- 日志/Metrics/Tracing：渲染观测。
- 错误处理：UI 错误呈现。
- 禁止：核心链路绕过 core。
- 演进：P1.5 单存储收敛（v2-bridge 删）；P2.3 视图拆分 + plan/verify/cost；P2.8 i18n（zh/en）。

### 2.10 sdk `packages/sdk/js`

- 职责/目的：客户端生成面。`src/v2/gen` 与 `src/gen` 双生成，`script/build.ts` 从 protocol 再生成。
- 边界：纯生成面。
- 生命周期：无状态。
- 依赖：生成期 schema/protocol。
- 公开 API：生成的 client/server 类型。
- 配置：无。
- 事件：生成的事件类型。
- 扩展点：无。
- 性能：生成体积有界。
- 测试：生成后契约一致。
- 日志/Metrics/Tracing：无。
- 错误处理：生成期错误。
- 禁止：手改生成面。
- 演进：v1/v2 server.ts 合并（P0.4）后再生成 diff 干净；v1 面随 v1 栈退役收窄。

### 2.11 effect-drizzle-sqlite `packages/effect-drizzle-sqlite`

- 职责/目的：基础设施。drizzle ORM × Effect 适配、SQLite 连接、迁移、session/event 表结构。
- 边界：无领域逻辑。
- 生命周期：连接池随组合根管理。
- 依赖：无工作区依赖。
- 公开 API：drizzle 适配与表定义。
- 配置：连接配置。
- 事件：无。
- 扩展点：无。
- 性能：连接复用、WAL/busy_timeout。
- 测试：迁移与 CRUD 测试。
- 日志/Metrics/Tracing：查询观测。
- 错误处理：SQLite 错误映射。
- 禁止：业务表之外的对象。
- 演进：官方 `drizzle-orm/effect-sqlite` 落地即替换（ADR-009）。

### 2.12 http-recorder `packages/http-recorder`

- 职责/目的：开发工具。HTTP 录制/回放。
- 边界：不进生产运行时链路。
- 生命周期：工具进程内。
- 依赖：无工作区依赖。
- 公开 API：录制/回放入口。
- 配置：fixture 路径。
- 事件：无。
- 扩展点：无。
- 性能：录制开销低。
- 测试：录制回放测试。
- 日志/Metrics/Tracing：工具日志。
- 错误处理：fixture 缺失报错。
- 禁止：生产链路。
- 演进：入口标 `@deprecated`（ADR-008）。

### 2.13 codemode `packages/codemode`

- 职责/目的：独立工具（CM 编辑器封装，独立分发）。
- 边界：不进 opencode 主链路直接 import（组合根注入）。
- 生命周期：按需创建。
- 依赖：无工作区依赖。
- 公开 API：CM 协议客户端、枚举、stdlib。
- 配置：CM 连接配置。
- 事件：CM 事件。
- 扩展点：无。
- 性能：连接复用。
- 测试：codemode 全量测试。
- 日志/Metrics/Tracing：协议观测。
- 错误处理：CM 协议错误分类。
- 禁止：被主链路静态 import。
- 演进：OpenAPI 封装移出公共面。

### 2.14 observability `packages/observability`（ADR-013）

- 职责/目的：横向观测层。统一管理 Logger / Tracing / Metrics / Profiler / Performance Monitor / Event Recorder / Diagnostic Context；是业务包唯一的观测出口。
- 边界：只做观测，不承载任何业务语义；不参与领域依赖方向。
- 生命周期：Layer 初始化（配置装载）→ 运行（记录）→ Scope 释放（flush/close）；Trace/Span 生命周期 start→end；指标批写异步导出。
- 依赖：schema（Log/Trace 契约）。
- 公开 API：`Observability.Service`（log / span / counter / timer / histogram / gauge / event / diagnostics）；`Logger`、`Tracer`、`Metrics`、`Profiler`、`Storage`、`Exporter`、`Diagnostics` 子接口。
- 配置：`observability.{level, enabled, sampling, storage, profiling}`（§6.5 配置化，禁止代码硬切）。
- 事件：观测事件（span 完成、性能告警、诊断事件）——与 EventV2 会话溯源严格分离。
- 扩展点：Exporter 注册（本地文件为默认）、采样策略。
- 性能：关闭路径零成本（no-op 无分配）；采样批写异步，不阻塞业务路径（§6.10）。
- 测试：契约测试、级别过滤、采样统计、存储滚动/切割/清理、诊断阈值触发。
- 日志/Metrics/Tracing：自身即观测实现，需自测与自观测（开销预算）。
- 错误处理：观测链路故障降级（记录失败不抛业务错误）。
- 禁止：依赖任何业务包；业务代码绕过接口直接 console.log / 写文件 / 调具体实现（§6.1）。
- 演进：Exporter 可扩展（远程 OTLP 等留接口，不提前实现）。

---

## 3. Module Constitution（模块级宪法）

### 3.1 统一模板（所有模块，禁止职责漂移/隐藏状态/跨模块访问内部实现）

```text
Module <name>（归属包）
- 职责：唯一职责陈述
- 输入 / 输出：类型化输入输出面（含事件）
- 状态：持久状态与内存状态边界
- 生命周期：创建/运行/销毁
- 依赖：显式依赖清单
- 缓存：缓存策略（若有）
- 事件：发布/订阅事件
- 异常：错误类型与失败分类
- 日志 / Tracing / Metrics：观测三件套要求
- 测试策略：单元/集成与基线
- 扩展点：允许扩展的钩子
```

模块是验收最小单元（§1.15 Module DoD）。

### 3.2 core 模块清单（按实施顺序）

| # | 模块 | 职责 | 遗留任务 | 状态 |
|---|---|---|---|---|
| C1 | session/（V2 核心） | SessionV2 状态机、prompt 准入、事件溯源 | — | 已有 |
| C2 | event/ | EventV2 溯源、replay 所有权 | — | 已有 |
| C3 | store/ | 会话持久化、Location 解析 | — | 已有 |
| C4 | tool/ | 工具注册表、执行、ACI 审计 | **P3.4** ACI 审计（绝对路径/失败分类/retryHint） | ✅ 已接线 |
| C5 | permission/ | 权限裁决（SessionToolPermissions 消费） | — | 已有 |
| C6 | config/ | 配置装载、迁移、校验 | — | 已有 |
| C7 | context 域 | ContextLevels、记忆检索注入 | **P3.5** 记忆检索式注入（L3 top-K） | ✅ 已接线 |
| C8 | agent/model/provider | 模型解析、路由 | — | 已有 |
| C9 | execution/ | SessionExecution 进程内协调、wake | — | 已有 |
| C10 | runner/ | 序列化 runner、投影、isolation | **P1.4** buildRequest 接线 projection/isolation | ✅ 记忆层注入+预算接线 |
| C11 | compaction | 压缩管道化 | **P3.1** 管道化+todo 锚定（pi） | ✅ todo 锚定接线 |
| C12 | planning/（goal） | goal 状态机+计划树+drift | **P3.2**（kimi）；tui plan 视图联动 | 待 |
| C13 | subagent/ | 子代理三件套 coder/explore/plan | **P3.3** | 待 |
| C14 | memory/ | 记忆持久化与检索（v2-memory 收编） | P3.5 联动 | 已有+待 |
| C15 | introspection/ | 决策快照/归因 | **P3.6** 自省接线+复盘命令 | 待 |
| C16 | system-context/ | 系统上下文代数、注册表、内建 | — | 已有 |
| C17 | v1 兼容（4 处只读） | 历史数据兼容 | — | 保留（ADR-006） |

core 拆分任务（P2.1）：runner 7 文件、git 目录、session 目录、bus 分文件——搬动只改 import 不改签名（P5）。

### 3.3 opencode 模块清单

| # | 模块 | 状态/任务 |
|---|---|---|
| O1 | cli（run/serve/attach/tui/init/v2） | 保留，v2 主路径 |
| O2 | session/（v1 运行栈 22 文件 ~8k 行） | P1.1 删 v1 工具表；P1.2 删 processor/ai-sdk；P1.3 删 prompt.loop；有 httpapi 消费者的暂缓登记，随 v1 端点退役删 |
| O3 | server/routes + httpapi handlers | 保留到 server 接管（批次 D/E 交接） |
| O4 | effect 组装（app-runtime） | 收敛为组合根，只接线 |
| O5 | groups（session/permission v1） | 随 v1 栈退役 |

### 3.4 tui / llm / schema 模块清单

tui：T1 单存储收敛（P1.5）、T2 视图拆分（P2.3）、T3 plan/verify/cost 视图（P2.3）、T4 i18n（P2.8）、T5 v2-bridge 删除。
llm：L1 llm/protocol 接口、L2 实现（native/ai-sdk/transform）、L3 provider 配置（P2.6 拆分）、L4 TokenCounts 消费（P2.5 联动）。
schema：S1 session 契约、S2 event 契约（P2.5 V2 前缀清理）、S3 llm 协议契约（P2.6 联动）、S4 TokenCounts（P2.5 新建组合子，替换 4 处重复账本）。

### 3.5 新契约登记

新增跨包契约（schema/protocol）必须先登记本节：契约名、归属包、消费方、identifier。未登记契约禁止进入实现。
现有登记：`LogEntry`、`TraceContext`（observability ↔ 业务包，ADR-014）、`TokenCounts`（session 域，消费方 core/llm，identifier `Session.TokenCounts`）。

### 3.6 observability 模块清单

| # | 模块 | 职责 | 状态 |
|---|---|---|---|
| OBS-1 | logger/ | 统一 Log Schema、级别过滤、结构化输出 | 批次 A 建 |
| OBS-2 | tracer/ | Trace/Span 生命周期、调用链还原、span 属性摘要 | 批次 A 建 |
| OBS-3 | metrics/ | Counter/Timer/Histogram/Gauge、指标聚合与窗口 | 批次 A 建 |
| OBS-4 | profiler/ | Profiling 模式：CPU/Memory/Latency/Token/IO/Network/Storage/Queue | 批次 A 建 |
| OBS-5 | storage/ | 本地日志存储：滚动/时间切割/压缩/查询/清理 | 批次 A 建 |
| OBS-6 | diagnostics/ | 慢调用/异常/回归检测，性能告警 | 批次 A 建 |
| OBS-7 | context/ | Diagnostic Context、采样决策、模式管理 | 批次 A 建 |

core 现有 `src/observability.ts`（及目录）迁入 observability 包（搬代码改 import 不改签名，P5）。

---

## 4. Architecture Governance（架构治理）

### 4.1 Architecture Freeze

宪法定稿即进入 **Frozen** 状态。禁止开发过程中随意修改。确需修改必须依次完成：
**Impact Analysis → ADR → Migration Plan → 统一更新本文件**。
禁止边开发边改架构；禁止开发中产生并行架构认知。

### 4.2 ADR 流程

重大决策（新增/放弃/修改/删除 Package、Module、依赖方向、接口规范）必须记录 ADR（格式见 §1.16），正文只保留最终方案，设计历史维护在附录 A。

### 4.3 Complexity Budget

整个项目复杂度必须持续下降。新增抽象必须证明收益 > 成本。禁止：过度设计、过度抽象、过度插件化、过度泛化。系统持续保持简单、稳定、清晰。

### 4.4 Zero Technical Debt

§1.14 全部条款；任何进入主干的 Package 必须是完整实现，不得依赖未来补充，不得把技术债留给后续阶段。

### 4.5 Package Completion（门禁）

一个 Package 必须满足 Package DoD 12 项（§1.15）才能开始下一个 Package。

### 4.6 Module Completion（门禁）

一个模块必须满足 Module DoD 5 项（§1.15）才能开始下一模块；禁止多个模块同时留半成品。

### 4.7 Self Review（每完成一个 Package 自动检查）

1. 是否违反 Constitution
2. 是否存在循环依赖
3. 是否重复实现
4. 是否已有能力可复用
5. 是否可以进一步删除
6. 是否增加复杂度
7. 是否降低性能
8. 是否破坏边界
9. 是否违反生命周期
10. 是否引入技术债
11. 是否接入 Observability（DoD 第 13 项；§6.9）

未通过 Review：禁止继续开发，先修正再推进。

### 4.8 Observability 接入门禁

新增/修改任何 Package、Module、Service、Tool、Provider：必须接入 Observability（Logger + Trace + Metric + Error Capture + Performance Timer，§6.9），否则不允许进入主干。接入走统一接口（§6.1），禁止直接依赖具体日志实现。

---

## 5. 实施流程

### 5.1 批次顺序（拓扑序，逐包完成制）

| 批次 | 包 | 核心任务 |
|---|---|---|
| A | schema → **observability** → effect-drizzle-sqlite → http-recorder → codemode | schema 清理+TokenCounts；observability 包搭建（OBS-1~7）；http-recorder 标 deprecated |
| B | protocol → llm | llm 协议拆分（接口/实现/配置）+ dead 门面标注 + 接入观测（token/first-token 指标） |
| C | core | runner 接线投影/isolation → 目录拆分 → P3 能力域 + 全模块接入观测（core 现有 observability 迁包） |
| D | plugin → server | plugin v1 出口退役评估；server 拆分+cursor 收敛 + 请求 span 接入 |
| E | opencode | v1 运行栈删除 → 组合根组装 + 组合根观测装配 |
| F | tui | 单存储收敛 → 视图拆分 + plan/verify/cost + i18n + 渲染观测（不阻塞会话） |
| G | sdk | v1/v2 server.ts 合并 → 再生成 |
| H | 包间链路组装 | L1 CLI → L2 serve/attach → L3 TUI → 跨链（含观测链路验证） |

### 5.2 组装链路验收矩阵

| 链路 | 参与者 | 接线 | 验收 |
|---|---|---|---|
| L1 CLI | opencode(cli/v2) → core(SessionV2) → llm(stream) → event 溯源 | `llm.stream` 每轮一次；投影历史续接 | `opencode run` 全场景 |
| L2 服务化 | opencode(serve) → server(HttpApi) → core；EventV2 进程内嵌事件桥 | 端点收敛 | httpapi 全绿；serve+sdk attach |
| L3 UI | tui → core（单存储）↔ EventV2 订阅 | v2-bridge 删除后直连 | TUI 全功能回归 |
| 跨链 | sdk ↔ server ↔ core；plugin 加载链 | sdk server.ts 合并；plugin v2 出口加载 core 工具 | 插件示例可跑；zh/en 可用 |

组装顺序 L1 → L2 → L3 → 跨链；每条不通过即回退对应包修订，不带病进下一条。

### 5.3 运行时宪法（Runtime）

- 进程形态：进程内嵌为默认（个人终端优先）；serve/attach 同一组合根两种挂载，不引入 daemon。
- 组合根唯一：opencode 进程是 core+server+tui+sdk 接线的唯一组装点；任何包不得自行启动运行时。
- 服务注入：全部服务走 Effect Layer + DI（P8）；`makeRuntime` 统一 `runPromise/runFork/runCallback`。
- InstanceState：按目录/项目的实例状态用 `InstanceState`（ScopedCache 键控），自动释放。
- 调度：SessionExecution 进程全局、Session ID 定位；干扰目标 = 进程内该 Session 的活跃所有权链；空闲/缺失干扰 = no-op。
- Drain 语义：进程内可中断执行段，无持久身份/transcript 边界；post-crash 续接需显式设计后（当前禁止）才可重试 provider 工作。

---

## 6. Observability Constitution（可观测性宪法）

让整个 AgentCLI（Project → Package → Module → Function → Runtime Node → Workflow Node → Tool → LLM Call → Memory → Storage → Provider → MCP → Transport）具备统一监控能力：任何关键节点的性能下降、延迟增加、错误、阻塞、Token 增长、内存增长、调用异常均可定位。本宪法与 §1-§5 同等约束力，业务包接入纪律见 §4.8。

### 6.1 Logging Rule（日志规则）

**统一抽象**：业务代码禁止直接依赖具体日志实现——禁止 `console.log`、直接写文件、直接调用 logger 实现。全部监控经统一接口：

```text
Business Module
    ↓
Observability Interface（Observability.Service）
    ↓
Logger / Tracer / Metrics / Profiler / Storage / Exporter
```

**统一 Log Schema**（每条日志必须包含；缺失字段记 null，禁止省略键）：

| 字段 | 必填 | 理由 |
|---|---|---|
| timestamp | 是 | 时序还原、切割、查询 |
| level | 是 | 过滤与告警分级 |
| service | 是 | 多进程/多服务归因（opencode-x） |
| package | 是 | 归属包（§2）定位 |
| module | 是 | 归属模块（§3）定位 |
| function | 是 | 函数/Effect.fn 名，配合包+模块精确定位 |
| traceId | 是 | 关联整条调用链 |
| spanId | 是 | 定位链内节点 |
| sessionId | 是 | 会话上下文归因 |
| agentId | 可选 | 代理归因 |
| workflowId | 可选 | 工作流/计划归因 |
| taskId | 可选 | 任务/子代理归因 |
| duration | 可选 | 耗时归因 |
| status | 是 | 成功/失败/阻塞/取消 |
| error | 可选 | 错误分类（§6.1 失败分类），异常追踪 |
| metadata | 可选 | 扩展键值（脱敏后） |

**日志级别**：

| 级别 | 使用场景 |
|---|---|
| TRACE | 参数摘要、逐步调用（仅 Debug/Profiling 模式） |
| DEBUG | 模块调用链、状态变化（Debug 模式） |
| INFO | 生命周期事件：session 创建/完成、tool 调用、provider 调用 |
| WARN | 重试、降级、阈值逼近、采样丢弃 |
| ERROR | 失败分类、调用异常（所有模式记录） |
| FATAL | 致命：启动失败、数据损坏、不可恢复 |

### 6.2 Trace Rule（追踪规则）

**Trace 生命周期**（一次用户请求）：

```text
User Request → Trace Start → Session → Runtime → Planner → Workflow → Node
→ Tool → LLM → Memory → Storage → Response → Trace End
```

每一步产生 Span，span 树可完整还原调用链（traceId 聚链 + parentId 树 + timestamp 排序）：

```text
Trace
 ├── Runtime Span
 ├── Planner Span
 ├── Workflow Span
 │    └── Node Span
 ├── Tool Span
 ├── LLM Span（含 first-token / stream / completion 子阶段）
 ├── Memory Span
 └── Storage Span
```

- Span 必须携带：name、startTime/endTime/duration、parentId、status、属性摘要（脱敏）、采样决策。
- Trace 与 EventV2 严格分离：观测 trace 不入会话溯源存储；会话事件不入观测日志（职责边界，P2）。
- 分布式/进程内：进程内链以内存传递；跨进程（L2 服务化）以 traceId 注入（HTTP 头/事件桥）为准，不提前实现协议。

### 6.3 Metric Rule（指标规则）

统一指标原语：**Counter**（计数：tool call、error）、**Timer**（耗时：duration、first token）、**Histogram**（分布：延迟分位）、**Gauge**（瞬时：queue length、内存）。

关键节点必采指标：

| 维度 | 指标 |
|---|---|
| 时间 | duration / startTime / endTime |
| 资源 | CPU / Memory / IO / Network（进程级，Profiling 模式开） |
| AI | token input / output / total；first token latency；stream latency；completion latency |
| Runtime | queue length / wait time；task execute time / retry count |
| Workflow | node duration / failed node |
| Tool | call count / success rate / error rate |

指标带标签：package、module、provider、tool、node。聚合窗口与基线存储由 observability 包持有（供 §6.7 诊断）。

### 6.4 Performance Rule（性能规则）

- 观测自身必须低成本：关闭路径零成本（no-op 无分配）、采样批写异步、无锁记录、span 开销预算（微秒级）。
- 禁止观测阻塞业务路径：导出/落盘全部异步；存储失败降级不抛业务错误。
- 每包接入观测的固定开销计入该包性能要求（§2 包宪法"性能要求"字段）。
- 性能回归判定以指标基线（duration/token/内存窗口）为准，由 §6.7 自动检测。

### 6.5 Debug / Production / Profiling Rule（运行模式）

模式配置化（config 域装载），**禁止修改代码开启/关闭**：

```yaml
observability:
  level: production      # production | debug | profiling
  enabled: true
  storage: local
  sampling: 10%          # production 默认 10%；debug 100%；profiling 100%
  profiling:             # profiling 专属开关（均默认关）
    cpu: false
    memory: false
    latency: false
    token: false
    io: false
    network: false
    storage: false
    queue: false
```

| 模式 | 行为 |
|---|---|
| production | 默认关 Debug；只保留 ERROR/WARN/FATAL + 核心 Metrics；采样 10%；存储 local |
| debug | 完整诊断：TRACE/DEBUG 全开、详细 Runtime Trace、模块调用链、参数摘要、耗时、资源消耗、状态变化；采样 100% |
| profiling | 性能分析：全采样 + CPU/Memory/Latency/Token/IO/Network/Storage/Queue 采集，输出 performance 目录 |

### 6.6 Storage Rule（存储规则）

Debug/Production 开启后自动生成本地日志：

```text
logs/
├── runtime/      运行时与生命周期日志
├── package/      按包分文件（package=<name>.log）
├── workflow/     工作流/计划执行日志
├── tool/         工具调用日志
├── llm/          LLM 调用与 token 日志
├── error/        ERROR/FATAL 汇总（错误追踪入口）
└── performance/  指标与性能数据（profiling/诊断输出）
```

策略（observability/storage 实现，全部必需）：
- **日志滚动**：按大小滚动（默认 10MB/文件，可配置）
- **时间切割**：按日切割（`YYYY-MM-DD` 后缀）
- **压缩**：滚动/切割后的历史文件 gzip 压缩
- **查询**：按 traceId / sessionId / level / time 检索（内置查询接口；索引以文件结构 + 头字段为准）
- **清理**：保留期（默认 7 天）与总容量上限（默认 500MB），超限自动清理，策略可配置

### 6.7 Diagnostic Rule（诊断规则）

自动诊断（OBS-6）：
- **慢调用检测**：基线表（tool/llm/provider/node 平均耗时 + 阈值），单次 ≥ 基线 × N（默认 10× 或绝对阈值 3s）→ 记录 Performance Warning（performance 目录 + ERROR 级诊断日志）。
- **异常检测**：错误率/重试率突增（对比滑动窗口基线，默认 2×）→ Warning；连续失败 → ERROR。
- **性能 Regression 检测**：指标窗口（duration/token/内存）对比历史基线（默认 7 天）→ Regression Warning。
- 诊断输出可回答：为什么慢 / 慢在哪 / 哪个 Tool / Provider / Workflow Node 导致 / Token 为何增长 / Memory 是否膨胀 / Context 是否过大——由 Trace 树（§6.2）+ 指标聚合（§6.3）直接回答，诊断事件落入 performance 目录。

### 6.8 Sampling Rule（采样规则）

- 采样决定作用于：日志（TRACE/DEBUG 级）、span 记录、指标窗口。ERROR/FATAL 永不采样。
- 默认采样率：production 10%、debug/profiling 100%；配置化（§6.5）。
- 采样决策在 OBS-7 context 统一做出并透传，禁止各模块独立采样（保证链完整性：整条 trace 同决策）。
- 采样仅统计，不改变业务行为。

### 6.9 接入规范（开发规范）

新增/修改任何 Package、Module、Service、Tool、Provider 的完成标准（§1.15 DoD 第 13 项，§4.8 门禁）必须包含：

1. **Logger**：本模块日志接入统一接口，级别语义符合 §6.1
2. **Trace**：关键调用产生 Span（§6.2），含 duration/status/属性摘要
3. **Metric**：必采指标（§6.3 表）接入 Counter/Timer/Histogram/Gauge
4. **Error Capture**：失败分类经 §6.1 error 字段记录，ERROR 级日志必带错误分类
5. **Performance Timer**：关键路径计时（duration 上报 + 诊断基线）

缺任意一项，Package 不允许进入主干。

### 6.10 性能影响分析（观测成本预算）

| 路径 | 成本控制 |
|---|---|
| 关闭/未启用 | no-op 接口，零分配零开销 |
| production 采样外 | 仅采样决策检查（原子读，ns 级） |
| 采样内 | 结构化记录 + 批写（环形缓冲，异步 flush），不阻塞业务 |
| 落盘/导出 | 异步、批量、压缩后写；失败降级不抛错 |
| 存储 | 滚动/切割/清理守护，不进入业务热路径 |
| 包级固定开销 | 计入各包性能要求（§2），批次验收对比基线 |

---

## 7. Data Contract Constitution（数据契约宪法）

### 7.1 Schema First（全部核心对象）

以下核心对象必须 Schema 化（schema 包为唯一形状来源，ADR-014 泛化），禁止模块间私自定义相似数据结构、禁止隐式数据转换、禁止跨模块传递未定义对象：

```
Context / Message / Event / AgentState / WorkflowState / ToolRequest /
ToolResponse / Memory / Session / Trace / Configuration
```

每个契约必须定义：**Schema / Version / Compatibility / Migration Strategy**。

### 7.2 契约要素

| 要素 | 要求 |
|---|---|
| Schema | schema 包定义（类型 + 编解码 + identifier 唯一稳定，§3.5 登记） |
| Version | 兼容别名过渡期（V2 前缀，ADR-011）；破坏性变更走 §12 演进流程 |
| Compatibility | 向后兼容（additive 字段 optional）；禁止静默改变既有字段语义 |
| Migration Strategy | wire schema version 事件（`session.next.wire.schema.version.changed`）+ 迁移记录；历史数据兼容只读（ADR-006） |

### 7.3 违规定义

- 跨模块传递 `unknown`/未定义形状的对象（观测/错误场景除外，需有界）。
- 模块间重复定义同义结构（发现即归并到 schema，P2）。
- 隐式转换（如字符串↔数字、投影缺省值）未登记即引入。

---

## 8. Error Constitution（错误宪法）

### 8.1 统一错误体系

```
BaseError
├── RuntimeError      运行时/基础设施
├── AgentError        代理编排
├── WorkflowError     工作流/计划
├── ToolError         工具执行（含 ACI 分类，C4）
├── ProviderError     LLM/provider（对接 llm 包 LLMError）
├── MemoryError       记忆
├── StorageError      存储
├── SecurityError     权限/安全
└── ValidationError   契约/配置校验
```

### 8.2 每类错误必定义

Error Code（稳定字符串，跨版本不变）/ Message（模型可读） / Context（结构化字段） / Trace（observability §6.2） / Retry Strategy（可重试性+退避） / Recovery Strategy（恢复动作） / Logging Level（ERROR 级必带分类，§6.1 error 字段）。

### 8.3 责任矩阵

| 角色 | 谁 |
|---|---|
| 处理（捕获边界） | 模块自身边界（不跨模块裸 throw，禁 catch-all 吞错） |
| 恢复 | 上层编排（runner/workflow），按 Retry/Recovery Strategy |
| 展示 | tui/CLI（错误分类呈现，不泄漏内部细节） |
| 记录 | observability ERROR 级（§6.1 error 字段 + 分类） |

实现约定：Schema.TaggedErrorClass（opencode 惯例）；跨包错误以 BaseError 分类 + ErrorCode 契约化（schema 登记）。

---

## 9. Configuration Constitution（配置宪法）

### 9.1 统一配置体系

禁止配置散落、禁止 .env 满天飞（秘密走 §10.3 Secret Access）。

```
Configuration
├── Schema         schema 化（config 域 C6，类型安全可验证）
├── Loader         文件（opencode.json）+ env + 默认值合并
├── Validator      schema 校验，启动失败快速暴露
├── Environment    development / debug / production / testing
├── Runtime Config 会话级覆盖（prompt 参数化）
├── Secret Manager credential 域唯一管理
└── Override Strategy  CLI > 环境变量 > 配置文件 > 默认值
```

### 9.2 要求

- 所有配置 Schema 化、类型安全、可验证、可追踪（变更记录来源）。
- 新增配置项必须在本文件登记（P13）；observability 配置（§6.5）走同一体系。
- 运行模式（production/debug/profiling）由配置决定，禁止代码硬切（§6.5）。

---

## 10. Security Constitution（安全宪法）

### 10.1 权限模型

```
Agent → Tool → Resource
```

最小权限原则：所有高风险能力必须经过 Permission Check，禁止默认无限权限。

| 能力 | 裁决点 | 现有承载 |
|---|---|---|
| Tool Permission | 按 session 的权限覆盖（子代理只读默认），Location-scoped、in-flight 有界 | core C5 + SessionToolPermissions |
| File Permission | 路径裁决（强制绝对路径，C4 ACI） | core tool/ |
| Network Permission | 网络访问裁决 | tool 权限面 |
| Secret Access | credential 域唯一管理，禁止日志暴露（§6.1 脱敏） | core credential/ |
| Sandbox | codemode 沙箱边界（无环境权限，工具供给制） | packages/codemode |
| Audit Log | 安全事件审计日志（权限拒绝/秘密访问/插件加载）接入 observability | §6 统一出口 |

### 10.2 进程与插件边界

- 内容进大脑过 isolation → projection；行动出大脑过 permission → tool（双向管道纪律，保留 §1.10 要点）。
- 插件加载：plugin v2 生命周期校验；禁止未登记出口进入核心路径。
- pty/子进程有界队列与超时；禁止无限输出。

### 10.3 Secret Access

- 密钥/凭证由 credential 域唯一管理（core credential/），禁止散落于配置（§9.1）或日志（§6.1 脱敏）。
- 访问密钥 = 高风险能力，必须经 Permission Check（Secret Access 行，§10.1）；禁止默认可见。
- 凭证读取路径接入审计日志（Audit Log 行，§10.1）。

---

## 11. Testing Constitution（测试宪法）

### 11.1 测试结构

```text
tests
├── unit          模块级（§3 模块表）
├── integration   包间链路（§5.2）
├── runtime       运行时可观测性验证
├── workflow      工作流/计划
├── provider      provider 录制测试（llm）
├── tool          工具执行
├── regression    回归（Golden 保护）
├── performance   性能基线
└── chaos         故障注入（资源受限路径）
```

### 11.2 核心要求

- 核心流程必须有：Unit + Integration + Regression + Performance 四类测试。
- Golden Test：保护 Prompt / Workflow / Tool Output / Agent Behavior；Golden 文件更新必须显式审查，禁止静默替换（防 AI 修改导致隐性回归）。
- 基线：core 311 测试文件全绿不降（附录 C）；测试运行于包目录（禁仓库根）；禁 Mock 真实服务（§1.13）；搬代码带测试（测试随迁）。

---

## 12. API Evolution Constitution（接口演进宪法）

### 12.1 版本化流程

所有 Public API 版本化，禁止直接破坏修改：

```
v1 → Deprecation → Migration → v2
```

破坏性变更必须依次完成：Deprecation 周期（标注 + 迁移指引 + 消费方清单）→ Migration Plan → 移除（ADR + 本文件登记）。

### 12.2 适用范围

Provider / Tool / Plugin / MCP / Runtime API 必须保持兼容策略；契约变更先登记（§3.5）；schema 兼容性按 §7；SDK 生成面（v1/v2 gen）同步策略（ADR-010）。
现有实例：`/message` 单数端点 deferred 记录（ADR-005）；V2 前缀兼容别名（ADR-011）。

---

## 13. Appendices

### 附录 A：ADR 记录

| ADR | 标题 | 决策（最终方案） | 放弃方案 | 状态 |
|---|---|---|---|---|
| ADR-001 | memory/workflow/planner 归属 | core 内域（memory + system-context；workflow=runner 编排；planner 并入 planning） | 独立包（官方亦未定型，保持 sync 兼容） | Accepted |
| ADR-002 | mcp 归属 | tool 内域 | 独立包 | Accepted |
| ADR-003 | registry 归属 | execution/runtime 内域 | 独立包 | Accepted |
| ADR-004 | 进程形态 | 进程内嵌默认；serve/attach 同组合根 | daemon 化 | Accepted |
| ADR-005 | `/message` 单数端点 | 维持（deferred 至 mini replay 全面 V2 化） | 立即合并双端点（数百行重写 + 回归风险，收益低） | Accepted |
| ADR-006 | v1 兼容引用 | 4 处只读保留（迁移/表类型/投影/兼容发布），禁止扩展 | 立即删除（破坏历史数据兼容） | Accepted |
| ADR-007 | core 形态 | 包壳 + 域接口化（显式化 event/storage/security/provider/tool 出口接口，不动文件位置） | 物理拆包（破坏 sync 兼容） | Accepted |
| ADR-008 | http-recorder | deprecated 标注，不进生产链路 | 删除/升级 | Accepted |
| ADR-009 | effect-drizzle-sqlite | 官方 `drizzle-orm/effect-sqlite` 落地即替换 | 长期维护自研适配 | Accepted |
| ADR-010 | SDK 双生成面 | v1/v2 server.ts 合并（P0.4），v1 面随 v1 栈退役收窄 | 永久双面 | Accepted |
| ADR-011 | V2 前缀清理 | schema 契约规范化后去除 V2 前缀（identifier 唯一稳定） | 永久保留 V2 命名 | Accepted |
| ADR-012 | 文档收敛 | 仅 README/AGENTS/本文件 三份长期文档；一切设计并入本文件 | 多文档体系（v3/v4/v5/specs 全删） | Accepted |
| ADR-013 | observability 归属 | 独立包 `@opencode-ai/observability`（只依赖 schema，供 core/llm/server/opencode/tui 共同注入） | core 内域（llm 禁止依赖 core，LLM Call 无法接入观测 → 否决） | Accepted |
| ADR-014 | Log/Trace 契约归属 | LogEntry / TraceContext 契约入 schema（跨包数据形状唯一来源） | observability 自包含契约（违反 schema SSOT） | Accepted |

### 附录 B：术语表

| 术语 | 定义 |
|---|---|
| System Context | 呈现给模型的初始指令+时序更新的结构化上下文集合（非 system prompt） |
| Session History | 经 compaction 与 Context Epoch 截断后投影的会话历史 |
| Context Source | System Context 内一个独立观测类型值（稳定 key + JSON codec + loader + renderer） |
| Session Drain | 进程内可中断执行段，无持久身份/transcript 边界 |
| Provider Turn | 一次 `llm.stream` 调用周期；新用户输入重置 provider-turn 配额 |
| Context Epoch | Session 持久化的历史投影纪元 |
| EventV2 Replay | 按 Session 重放事件重建投影；replay 所有权与执行所有权分离 |
| V2 | 当前架构主轴（SessionV2/EventV2）；schema 契约规范化后去除 V2 前缀 |
| 组合根 | opencode 进程把 core+server+tui+sdk 接线的唯一组装点 |

### 附录 C：实现状态基线

| 项 | 基线 |
|---|---|
| core 测试 | 145 测试文件全绿（不降基线） |
| 包 typecheck | schema/protocol/llm/core/server/opencode/tui 全绿 |
| 测试运行位置 | 包目录（禁止从仓库根跑） |
| 批次进度 | A **Completed**；B **Completed**（protocol 2 绿 + llm 310 绿 + 观测接入）；C **进行中**（core：观测迁包 ✅ → git/bus 目录拆分 P2.1 → P3 能力域接线：C4 P3.4 ACI ✅ → C7 P3.5 记忆注入 ✅ → C10 P1.4 buildRequest 记忆层接线 ✅ → C11 P3.1 todo 锚定 ✅ → C12/C13 core 内闭环，剩余协议面/组合根归 D/E/F → 全模块观测）；D-H 未开始（§5.1 表） |
| 包总数 | 13（12 + observability，ADR-013） |
| Observability 接入 | 全部业务包完成接入（DoD 第 13 项）后方可进批次 H |
