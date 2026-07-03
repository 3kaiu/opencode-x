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

| 函数 | 使用位置 |
|------|---------|
| `executeShell` | `bash.ts` (Rust fast path, 回退 AppProcess) |
| `globFiles` | `glob.ts` (Rust fast path, 回退 ripgrep) |
| `grepFiles` | `grep.ts` (Rust fast path, 回退 ripgrep) |
| `readFile` | `fs-util.ts` (Rust fast path, 回退 Effect FS) |
| `writeFile` | `fs-util.ts` (Rust fast path, 含自动创建目录) |

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
                      Rust natives (7 模块)
natives/shared           ✅ 工具库 + tiktoken-rs
natives/token-counter    ✅ Zig WASM (备选 fallback)
natives/sqlite           ✅ Rust SQLite
natives/prompt-builder   ✅ 5 函数全部投产
natives/tool-exec        ✅ 5 函数全部投产
natives/provider-proxy   ✅ HTTP+SSE (reqwest)

                      TS 集成点
Token.estimate           Rust tiktoken → Zig WASM → chars/4
bash.ts                  Rust executeShell fast path
glob.ts / grep.ts        Rust glob/regex fast path
fs-util.ts               Rust readFile/writeFile fast path
llm/http.ts              Rust streamSse fast path (回退 fetch)
system.ts                Rust selectProviderTemplate (替换 TS 逻辑)
prompt.ts                Rust assembleSystemPrompt (替换手动合成)

                      未做
Provider 配置生成        7+ OpenAI 兼容 provider 可从 YAML 生成
Agent Loop 编排         TS Effect 保留
```