# plugin 包深度审计报告

日期：2026-08-13
范围：packages/plugin（v1 出口 + v2 effect/promise 双面）+ core 侧宿主（host/plugin/promise/internal）+ opencode v1 加载链（只读）
依据：ARCHITECTURE_CONSTITUTION.md §2.7 / §6.9 / §5.1 / ADR-015
方式：深度探索 + 对抗审计（正确性/安全/简洁/轮子）+ 直接运行时审读

## 结构画像

- **v1 出口**（`src/index.ts` 344 行 / `shell.ts` 148 行 / `tool.ts` 64 行 / `tui.ts` 665 行）：已 deprecated，但 opencode v1 加载链、tui runtime、12 处 provider/auth 插件仍在消费（ADR-015 退役挂起中）。
- **v2 effect 面**（`src/v2/effect/`，310 行 TS）：agent/aisdk/catalog/command/context/event/integration/plugin/reference/registration/skill/tool/turn 共 12 个模块 + index。
- **v2 promise 面**（`src/v2/promise/`，132 行 TS）：同名的 10 个模块，**缺 event/tool/turn 三域**（context 缺 4 域：event/tool/turn/session）。
- **运行时宿主在 core**（非 plugin 包本身）：
  - `core/src/plugin/host.ts`（379）12 域接口桥 + hook 降级
  - `core/src/plugin.ts`（169）PluginV2.Service：add/remove/wait + KeyedMutex + State.batch
  - `core/src/plugin/promise.ts`（93）fromPromise 适配器
  - `core/src/plugin/internal.ts`（153）12 个内置插件注册
  - `core/src/config/plugin/external.ts`（91）外部 v2 插件加载
- **v1 加载链在 opencode**（`src/plugin/`：index/loader/shared/install/meta + tui/runtime.ts）。
- plugin 包自身无测试目录；由 core（12 测试）/opencode（~30 文件）/tui 间接覆盖。

## 审计结论

### ✅ 通过项（强证据）

- **正确性**：
  - host.ts 全部 6 类 hook（tool before/after、turn before/after、session start/end）降级策略一致：`Effect.tapError(logWarning) + Effect.ignore`，注释明确"buggy plugin 不拖垮 runner"；tool before 的 deny/skip/modifiedInput 分支完整。
  - event.subscribe 桥（host.ts:114-129）：未知类型返回空流；编码 payload 用 `Stream.catch` 降级不 defect 整条订阅。
  - fromPromise（core/plugin/promise.ts）与 promise 类型面（v2/promise/*）契约逐字段一致（Registration `dispose: () => Promise<void>`、transform/reload/plugin.add 递归）——promise 缺四域是**同步一致的能力缺口**，非运行时契约破坏。
- **并发/生命周期**：plugin.ts 的 KeyedMutex + loading Set（load-cycle 检测）+ State.batch 批量重建正确；add 用 Scope.fork + onExit 关闭；插件 effect 抛错时 scope close + failures 记录，wait 可感知失败。remove 正在执行插件干净。
- **宪法符合性**：依赖只 sdk（+effect/zod/@ai-sdk-provider），零 core/server/opencode 反向依赖；packages/plugin 内零 console.log、零 TODO/FIXME/XXX；P4 插件优先成立。
- **测试**：core 的 test/plugin.test.ts + promise.test.ts + config/plugin.test.ts 共 12 测试全部通过。

### 🔸 MEDIUM

| # | 位置 | 问题 | 建议 |
|---|---|---|---|
| 1 | `packages/plugin/src/v2/promise/README.md:3-8` vs `context.ts:12-21` | promise 面缺 event/tool/turn/session 四域，但 README 宣称与 effect "same two in-process capabilities" 对等——文档误导，promise 插件作者期待的 `ctx.tool.hook` 编译报错且无"尚未提供"提示 | README 明示 promise 面是 effect 面子集；或（成本高）在 fromPromise 补齐四域 |
| 2 | `packages/plugin/src/v2/effect/index.ts:1-6` | 不导出 Registration/Reload/Hooks，与 promise 面（index.ts:5 有）不对称——effect 作者无法具名声明 transform 返回值类型或 Hooks 代数 | 补 `export type { Registration, Reload, Hooks }` |
| 3 | `packages/plugin/src/example.ts:1-18` + `example-workspace.ts:1-34` | 死代码随包发布：零消费者、无 exports 入口、`build: tsc` 编进 dist、演示已废弃的 v1 API | 删除 |
| 4 | `packages/opencode/test/config/plugin.test.ts` | 空文件（0 行）被 git 跟踪 | 删除 |
| 5 | `packages/core/src/config/plugin/external.ts:87` | `Effect.ignoreCause` 使插件加载失败完全静默、无日志——违反 §6.9 观测接线精神，debug 极难 | 改为 logWarning/logError 后再降级 |
| 6 | `packages/opencode/src/plugin/index.ts:185-186` + `tui/src/plugin/runtime.ts:1090-1091` | 空 if 死块（`if (纯模式 && 有插件来源) {}`），无注释无日志 | 删除或补告警日志 |
| 7 | `packages/opencode/src/plugin/loader.ts:15` | `export namespace PluginLoader` 违反仓库规范（AGENTS.md 明确禁用 namespace） | 改 flat 导出 + `export * as PluginLoader` |

### 🔸 LOW

- v1 类型 deprecated 标记不全：index.ts 的 ProviderContext/WorkspaceInfo/WorkspaceTarget/WorkspaceAdapter/PluginOptions/Config/AuthHook/AuthOAuthResult/ProviderHookContext/ProviderHook + tui.ts 约 40 个支撑类型均无 `@deprecated`（出口类型有、支撑类型无，IDE 悬停无废弃提示）。`Config` 实际消费者仅 `(hook as any).config?.(cfg)`，已是事实死类型。
- `effect/aisdk.ts` 与 `promise/aisdk.ts` 字节级相同（18 行），可抽共享文件。
- `promise/integration.ts:9,11` 内联 `import("...")` 类型 vs 同文件具名导入，与 effect 面风格不一致。
- `v2/effect/PLAN.md`（515 行）大面积过时：`rebuild()` vs 实际 `Reload.reload()`；tool transform 从未落地但 PLAN 列为可 transform 域；`ctx.integration.get` 已不存在。建议删除或压缩。
- `v2/effect/README.md` 已上线 turn/session/tool hooks 未文档化。
- `opencode/src/plugin/index.ts:194-195` + `tui/runtime.ts:752`：report.start/missing 空回调（loader 可选、传空等于没传）。
- `plugin/script/publish.ts`:2 `Script = { channel: "latest" }` 单键对象过度包装。
- `src/shell.ts` 事实死文件（无 package.json 出口；仅 index.ts:15 type 引用 BunShell）。
- `scratch register`：v1 loader 的 readV1Plugin "detect" 对 v2 形状模块（含 `id` 无 `server`）会 TypeError 被吞、仅记 error 日志（opencode/src/plugin/shared.ts 路径，探索发现未直接复现）。

### 🔸 已核查无需改动（明确结论）

- `registration.ts` 的 `Hooks<Spec>` 代数被 plugin 包 7 处消费，非无效抽象；core host.ts 手工写 12 域签名是桥接实现，不该复用。
- `PluginDomain.add/remove` 声明与 core 实现、promise 适配三方签名一致，无漂移。
- host.ts 的 `mutable()` 深改断言（DeepMutable）未掩盖结构问题（内部 draft 本就可变，仅放宽 SDK 只读类型）。
- provider/* 20+ 文件 aisdk.sdk 样板重复属每文件 1-3 行业务差异，抽 helper 是过早抽象。
- effect/promise 双面的 draft 类型共享（promise 5 个包装文件复用 `../effect/*` 的 Draft）是必要重复（返回类型不同）。

## 处理建议（按收益/风险排序）

用户决策：**只报告不动手**，报告已提交文档，后续综合处理。→ **2026-08-15 已全部落地**（见下方修复状态）。

1. 文档对齐（低风险高价值）：promise README 明示缺四域 / effect README 补 hooks / 删除或压缩 PLAN.md
2. `effect/index.ts` 补 Registration/Reload/Hooks 导出（纯类型面补全）
3. 删死代码：example*.ts、空测试文件、空 if 死块（涉及 opencode/tui 需注意 H 批次）
4. external.ts 加载失败改日志（core，非 H 区）
5. v1 支撑类型批量补 deprecated 标记；`Config` 可删
6. aisdk 共享化、publish.ts 简化、namespace 规范化（opencode 区，随 ADR-015 排期）

## 验证基线

- core plugin 相关测试：12 pass / 0 fail
- plugin 依赖方向、零 console、零 TODO 已 grep 验证

## 修复状态（2026-08-15 复核）

本报告全部条目已于提交 `71cb1f55c8`（refactor(plugin,tui,opencode): flatten loader, dedupe v2 aisdk spec, extract session bindings）及后续 checkpoint（`680bc5f01d`、`b2fe6dfaf3`）落地，逐项复核：

| 条目 | 修复方式 | 证据 |
|---|---|---|
| MEDIUM 1 promise README 误导 | README 增注 promise 面为 effect 面子集（event/tool/turn/session 四域 Effect-only） | `src/v2/promise/README.md:10-14` |
| MEDIUM 2 effect 面缺类型导出 | 补 `export type { Registration, Reload, Hooks }` | `src/v2/effect/index.ts:7` |
| MEDIUM 3 死代码 example.ts / example-workspace.ts | 已删除 | `src/` 下无此二文件 |
| MEDIUM 4 空测试文件 | 已删除 | `packages/opencode/test/config/plugin.test.ts` 不存在 |
| MEDIUM 5 external.ts 加载失败静默 | `Effect.ignoreCause` → `catchCause` + `Effect.logError` | `core/src/config/plugin/external.ts:87-91` |
| MEDIUM 6 空 if 死块 ×2 | opencode 侧补 `logWarning("plugins ignored in pure mode")`；tui runtime.ts 重构为 runtime.tsx 后死块消失 | `opencode/src/plugin/index.ts:185-186` |
| MEDIUM 7 namespace 违规 | loader.ts 改 flat 导出 + `export * as PluginLoader` | `opencode/src/plugin/loader.ts:237` |
| LOW v1 支撑类型 deprecated 标记 | 10 个类型（ProviderContext/WorkspaceInfo/WorkspaceTarget/WorkspaceAdapter/PluginOptions/Config/AuthHook/AuthOAuthResult/ProviderHookContext/ProviderHook）均补 `@deprecated` | `src/index.ts` |
| LOW aisdk 双面字节重复 | 共享 spec 抽至 `src/v2/aisdk.ts`，双面各留 4 行薄包装 | `src/v2/{effect,promise}/aisdk.ts` |
| LOW integration 导入风格 | 内联 `import("...")` 改具名类型导入 | `src/v2/promise/integration.ts:1-3` |
| LOW PLAN.md 过时 | 已删除 | `src/v2/effect/` 下无 PLAN.md |
| LOW effect README 缺 hooks 文档 | tool/turn/session hooks 均已文档化 | `src/v2/effect/README.md:85-115` |
| LOW report start/missing 空回调 | loader 侧不再传空回调（可选即不传），error 回调保持完整实现 | `opencode/src/plugin/index.ts:194-217` |
| LOW publish.ts 过度包装 | `Script = { channel }` 已简化为 `const channel = "latest"` | `script/publish.ts:5` |
| LOW shell.ts 事实死文件 | **保留**：ADR-015 v1 出口退役挂起中，随退役执行删除 | — |
| LOW scratch register 探测 | 未复现，维持记录 | — |

审计闭环：MEDIUM 7/7、LOW 7/9 已修复；2 项有意保留（shell.ts 随 ADR-015 退役、scratch 未复现）。plugin 包及消费方无新增技术债。