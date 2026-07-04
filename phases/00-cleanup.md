# Phase 0: Fork + 清理 + 基础设施

**目标**: 基于 upstream v1.17.13 建立 fork，清除无用代码，搭好多语言构建骨架。

## 完成状态 ✅

### 0.1 Fork 并固定版本 ✅
- `git fetch --tags upstream`
- `git checkout -b main v1.17.13`

### 0.2 删除无用包 ✅
- `app/`, `desktop/`, `slack/`, `enterprise/`, `web/`, `codemode/`, `function/`, `http-recorder/`, `httpapi-codegen/` 已清
- `server/` 保留

### 0.3 删除遥测代码 ✅
- Sentry / OpenTelemetry / OTLP 已清
- `experimental_telemetry` 引用已清

### 0.4 搭建目录结构 ✅
- `natives/` — Rust napi-rs + Zig WASM
- `.upstream/` — git worktree (v1.17.13)

### 0.5 配置 Bun ✅
- `bun install` pass
- `--help` / `--version` 正常

### 0.6 配置 Rust 构建 ✅
- Cargo workspace: shared, sqlite, prompt-builder, provider-proxy, tool-exec
- 全部 `cargo build` pass

### 0.7 配置 Zig WASM 构建 ✅
- `natives/token-counter/build.zig`
- `zig build` pass

### 0.8 验证 ✅
- `bun run build:all` pass (WASM + Cargo + napi)
- 所有 3 个核心包 typecheck pass

### 0.9 设置 CI ✅
- `.github/workflows/ci.yml` — TS lint + Rust build + Zig build

### 0.10 测试合并流程 ✅
- 冲突模式已确认
- MERGE.md 文档

## 修复的 Bug

| 文件 | 问题 |
|------|------|
| `packages/core/src/observability.ts:15` | `Effect.succeed(Layer.empty)` → `Layer.empty` |
| `packages/core/src/util/token.ts:11` | WASM loader 路径错误 |

---

# Phase 1: Token Counter

## 完成状态 ✅

- Zig WASM 管道通（UTF-8 码点计数）
- **升级**: Rust tiktoken-rs (cl100k_base) BPE tokenizer
- 识别链: Rust tiktoken → Zig WASM → chars/4 启发式
- 已接入 `Token.estimate`

---

# Phase 2: Session Store — Rust + rusqlite

## 完成状态 ✅

- `natives/sqlite/` — exec / queryAll / queryValues
- `sqlite.rust.ts` — TS 壳对接 `effect/unstable/sql`
- `#sqlite` 别名已指向 Rust 实现
- Drizzle ORM 集成

---

# Phase 3: Prompt Builder

## 完成状态 ✅

所有 5 个 Rust napi 函数已投产：

| 函数 | 使用位置 |
|------|---------|
| `selectProviderTemplate` | `session/system.ts` (替换 TS 重复逻辑) |
| `assembleEnvironment` | `session/system.ts` |
| `assembleSkillsBlock` | `session/system.ts` |
| `assembleMcpBlock` | `session/system.ts` |
| `assembleSystemPrompt` | `session/prompt.ts` (替换手动合成) |

---

# Phase 4: Provider Proxy

## 完成状态 ✅

- `natives/provider-proxy/` — reqwest HTTP + SSE 分帧
- 已注入 `packages/llm/src/route/transport/http.ts` `httpJson` 的 `frames` 方法
- 运行时检测 .node 可用性，不可用回退 fetch
- 不影响协议层（协议层无感知）

---

# Phase 5: Tool Exec

## 完成状态 ✅

### 保留（基准测试验证有价值）

| 函数 | 使用位置 | Rust 加速比 |
|------|---------|------------|
| `globFiles` | `glob.ts` (Rust fast path, 回退 ripgrep) | **6.8x** |
| `grepFiles` | `grep.ts` (Rust fast path, 回退 ripgrep) | **4x** |

### 移除（基准测试后发现无性能增益）

| 函数 | Rust vs TS | 结论 |
|------|-----------|------|
| `executeShell` → `bash.ts` | 239ms vs 245ms | 持平，OS fork 是瓶颈 |
| `readFile` → `fs-util.ts` | 36K ops/s vs 125K ops/s | Node C++ 绑定更快 (3.4x) |
| `writeFile` → `fs-util.ts` | 14K ops/s vs 51K ops/s | Node C++ 绑定更快 (3.6x) |

### 经验教训

Rust napi-rs 仅在以下场景提供价值：
1. 消除子进程开销（glob/grep vs ripgrep）
2. 关键路径需要重试/超时（SSE 流式）
3. 需要 Rust 生态的准确算法（tiktoken BPE）
4. 需要 Rust 生态的数据库驱动（rusqlite）

单纯把 Node C++ binding 替换为 Rust FFI（文件 I/O）或 OS fork（shell exec）不会更快。

---

# Phase 6: Agent Loop

## 状态：不做 Rust 重写

Agent loop (~2,830 LOC) 是纯 TS Effect 编排逻辑：
- LLM 流式 → 已 Rust (Phase 4)
- Tool 执行 → 已 Rust (Phase 5)
- 文件操作 → 已 Rust (fs-util.ts)
- Session 存储 → 已 Rust (Phase 2)
- **编排决策** → 保留 TS（Effect 的强项）

---

# 构件总览

```
                      Rust natives (5 模块 + 1 Zig)
natives/shared           ✅ tiktoken-rs BPE tokenizer
natives/sqlite           ✅ rusqlite (WAL mode)
natives/prompt-builder   ✅ 5 系统提示组装函数
natives/provider-proxy   ✅ reqwest HTTP + SSE 分帧
natives/tool-exec        ✅ glob_files (6.8x) + grep_files (4x)
natives/token-counter    ✅ Zig WASM UTF-8 码点计数 (fallback)

                      TS 集成点 (仅保留有价值路径)
Token.estimate           Rust tiktoken → Zig WASM → chars/4
glob.ts                  Rust globFiles fast path (6.8x)
grep.ts                  Rust grepFiles fast path (4x)
llm/http.ts              Rust streamSse fast path (重试+超时)
system.ts                Rust selectProviderTemplate
prompt.ts                Rust assembleSystemPrompt

                      未做
Provider 配置生成        7+ OpenAI 兼容 provider 可从 YAML 生成
Agent Loop 编排         TS Effect 保留 (设计决策)

                       已移除 (基准测试验证后)
bash.ts Rust fast path   ❌ 239ms vs 245ms 持平
fs-util.ts Rust path     ❌ Node fs 更快 (3.4x-3.6x)
```

---

# 对抗审计 & 批量删除 (2026-07-04)

## 背景

所有 6 个 Rust napi 模块 + 1 Zig WASM 投产后的关键问题：
- 10/12 napi 函数是 sync（阻塞事件循环）
- 16 MB .node 文件 + 194 crate 依赖
- 没有任何基准测试验证过"Rust 一定比 TS/Bun 快"

## 基准测试框架

`script/benchmark-native.ts` 覆盖 28 个数据点：
- 速度 (单次/批量)
- 冷启动 (首次调用时间)
- 并发 (1/10/50 并发)
- 可扩展性 (输入规模逐步增长)
- 事件循环阻塞 (setTimeout + 原生函数交叉)
- 内存 (RSS 差)
- CPU (用户态+内核态)
- 线程模型 (sync 或 async napi)

## 结果

| 模块 | 结论 | 关键数据 |
|------|------|---------|
| **grep** | **保留** | async, ~10000x 快于 ripgrep spawn (0.001ms vs 9-11ms) |
| **glob** | 删 | Bun.Glob 2x 更快, sync 阻塞, 含在 tool-exec crate |
| **sqlite** | 删 | bun:sqlite 5.5x 更快, sync 阻塞, 2.6MB |
| **prompt-builder** | 删 | TS join() 8x 更快, sync 阻塞, 0.9MB |
| **tiktoken** | 删 | TS 启发式在亚微秒级完成, sync 阻塞, 5.9MB |
| **SSE** | 删 | TS fetch 5.4x 更快, reqwest 4.0MB |

## 批量删除执行

### Batch 1 (prompt-builder + token-counter + SSE)

- `natives/prompt-builder/` + `packages/opencode/src/prompt-builder/` → 删
- `natives/shared/` + `natives/token-counter/` + `packages/core/src/util/index.node` → 删
- `natives/provider-proxy/` + `packages/opencode/src/provider-proxy/` → 删
- `packages/core/src/util/token.ts` → 纯 TS `Math.round(text.length / 4)`
- `packages/opencode/src/session/prompt-builder.ts` → 纯 TS (5 函数)
- `packages/llm/src/route/transport/http.ts` → 简化为纯 TS fetch
- Typecheck: 3 包通过 ✅
- 测试: 7/7 通过 ✅

### Batch 2 (sqlite + glob)

- `natives/sqlite/` → 删, `#sqlite` 切到 `sqlite.bun.ts`
- `natives/tool-exec/src/lib.rs` → 移除 `glob_files` 函数
- `packages/native-bridge/src/glob.ts` → Bun.Glob
- `packages/core/src/tool-exec/index.ts` → 仅 grepFiles 导出
- Typecheck: 3 包通过 ✅
- 测试: 7/7 通过 ✅

### Batch 3 (保留)

- `natives/tool-exec/` — 仅 `grep_files` (async, ~10000x)

## 最终架构

```
Cargo workspace: 5 members → 1 member (tool-exec)
Native-bridge: 5 entries → 2 entries (glob.ts=Bun, grep.ts=Rust)
.node 文件: 16 MB → 270 KB
Cargo deps: 194 → ~15 (仅 tool-exec)
Rust 线程: 10 sync + 2 async → 0 sync + 1 async
构建步骤: build:wasm + build:native + build:napi → build:native + build:napi (仅 tool-exec)
```

## 经验教训

1. **先基准测试，再决定语言** — "Rust 就是快" 在 napi-rs 场景通常不成立
2. **sync napi 阻塞事件循环** — 大部分 Rust napi 函数 sync，多代理场景有隐患
3. **Bun 原生 API 极快** — Glob / fetch / sqlite 绑定在 Bun 中是 C 级性能
4. **napi-rs FFI 有固定开销** — 亚微秒级操作不值得跨语言调用
5. **没有证据的优化不是优化** — Phase 1-5 从未运行过基准测试
```