# 性能基准报告

> 2026-07-05 · opencode-x fork (v1.17.13 base) · Bun 1.3.5 · macOS arm64

## 汇总

| 模块 | Rust | TS | Rust 优势 | 结论 |
|------|------|----|----------|------|
| **Glob** (搜索 .ts 文件) | 766 ops/s | 117 ops/s | **6.5x ↑** | 无子进程开销 |
| **Grep** (搜索 "export") | 327 ops/s | 75 ops/s | **4.4x ↑** | 无子进程开销 |
| **Shell exec** (echo) | 374 ops/s | 411 ops/s | ~持平 | 瓶颈在 OS fork |
| **File read** (14KB) | 36K ops/s | 125K ops/s | **3.4x ↓** | Node C++ binding 更快 |
| **File write** (14KB) | 14K ops/s | 51K ops/s | **3.6x ↓** | 同上 |
| **Token count** (4600 chars) | 2K ops/s | 222M ops/s (启发式) | **110x ↓** | tiktoken 做真 BPE，启发式只做除法 |

## 详细分析

### 1. Glob — Rust 6.5x 优势 ✅

```
Rust glob_files:    65 ms / 50 次调用 = 766 ops/s
TS ripgrep 子进程:  427 ms / 50 次调用 = 117 ops/s
```

**原因**: TS 每次搜索都要 `fork + exec rg` 二进制。Rust 直接在进程内遍历目录树，零进程开销。

### 2. Grep — Rust 4.4x 优势 ✅

```
Rust grep_files:    61 ms / 20 次调用 = 327 ops/s
TS ripgrep 子进程:  267 ms / 20 次调用 = 75 ops/s
```

**原因**: 同 glob——子进程启动是主要瓶颈。Rust 在进程内用 `regex` crate 并行搜索。

### 3. Shell Exec — 持平

```
Rust execute_shell: 268 ms / 100 次 = 374 ops/s
TS execSync:        244 ms / 100 次 = 411 ops/s
```

**原因**: 两者最终都调用 OS `fork + exec`。语言层差异被 OS 进程创建开销淹没。

### 4. File I/O — Node 更快 ⚠️

```
Rust read_file:     14 ms / 500 次 = 36K ops/s
Node readFileSync:   4 ms / 500 次 = 125K ops/s

Rust write_file:    36 ms / 500 次 = 14K ops/s
Node writeFileSync: 10 ms / 500 次 = 51K ops/s
```

**原因**: Node 的 `fs` 模块是 V8 层面的 C++ 绑定，直接调用 libuv。Rust napi-rs 需要经过 JS↔Rust FFI 边界，每次调用有额外开销。对于小文件（14KB），FFI 开销超过了 Rust 的计算优势。

**建议**: fs-util.ts 的 Rust fast path 可考虑移除或仅用于大文件。Node 原生 fs 对小文件更优。

### 5. Token Counter — 准确性 vs 速度的权衡

```
输入: 4600 chars (200 行代码)

Rust tiktoken (cl100k_base):  250 ms / 500 次 = 2,002 ops/s
Zig WASM (UTF-8 码点):          1.4 ms / 500 次 = 350,150 ops/s
TS heuristic (chars/4):         0 ms / 500 次 = 222,222,222 ops/s
```

**分析**:
- tiktoken 做真实 BPE 分词（正则 + 词表查找），比 UTF-8 码点计数慢 175x
- 但 2000 ops/s 对于 agent 运行时足够（token 计数不在消息流的关键路径上）
- 启发式极快但不准确（英文差 2x，中文差 4x+）
- **当前策略正确**: tiktoken 优先 → Zig WASM → 启发式

## 结论与建议

| 集成点 | 保留？ | 理由 |
|--------|--------|------|
| glob.ts Rust fast path | ✅ | 6.5x 加速，显著 |
| grep.ts Rust fast path | ✅ | 4.4x 加速，显著 |
| bash.ts Rust fast path | ✅ | 持平但保留（无回退需要） |
| fs-util.ts Rust fast path | ⚠️ 可选 | Node 原生更快，考虑移除 |
| Token tiktoken | ✅ | 准确性值得代价 |
| llm/http.ts Rust SSE | 待测 | 需真实 API key 测流式性能 |

### 未测试

- **Provider Proxy (HTTP+SSE)**: 需要真实 LLM API key 进行流式测试。reqwest 相比 fetch 的优势主要在连接池复用和 TLS 握手，理论上有 2-3x 的首字延迟优势。
- **SQLite**: 需要 session 级别测试。rusqlite 相比 better-sqlite3 的优势在于 WAL 模式和并发写入。
- **Prompt Builder**: 系统提示组装是低频操作（每次 session 启动一次），性能差异可忽略。