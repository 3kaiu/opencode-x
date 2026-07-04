# opencode-x 综合审计报告

审计日期: 2026-07-04
审计范围: packages/*, natives/, script/, phases/, AGENTS.md, PLAN.md
审计维度: 安全、性能、对抗、依赖、代码质量、Git

---

## 🔴 级别 1：立即修复

### ~~CRIT-01: `*.node` 二进制文件被 git 跟踪~~ ✅ 已修复

**修复**: `*.node` 已加入 `.gitignore`，`git rm --cached` 已执行。
**Residual**: 旧 git 历史中仍包含该二进制文件，不影响未来操作。

### ~~CRIT-02: 218 个文件 staged 但未提交~~ ✅ 已修复

**修复**: 已提交为 `chore: remove unused upstream files (Phase 0 cleanup)` (commit `7ccbe436e`)。

---

## 🟠 级别 2：高优先级

### HIGH-01: TypeScript strict mode 未全局启用

| 包 | strict |
|---|--------|
| core | ❌ |
| opencode | ❌ |
| llm | ❌ |
| native-bridge | ❌ |
| ui | ✅ |
| 其余 12 个包 | ❌ |

只有 `packages/ui` 启用了 `"strict": true`。其余 15 个包使用默认宽松设置，意味着：
- `strictNullChecks` 关闭 → `null`/`undefined` 可能悄悄传播
- `noImplicitAny` 关闭 → 隐式 `any` 不被检测
- `noUncheckedIndexedAccess` 关闭 → 对象索引可能返回 `undefined`

**建议**: 分批逐个包启用 strict mode，从 `core` 开始（最核心）。

### HIGH-02: Rust grep — 用户输入直接传入 regex 引擎

**文件**: `natives/tool-exec/src/lib.rs:21`
```rust
let re = regex::Regex::new(&pattern)
    .map_err(|e| Error::from_reason(format!("Invalid regex pattern: {e}")))?;
```
用户提供的 pattern 直接传给 `regex::Regex::new()`。Rust `regex` 使用 NFA（无回溯），**不易受 ReDoS 攻击**，但复杂 pattern + 大文件仍可导致高 CPU。

**缓解**: Rust `regex` crate 保证 O(n) 匹配时间，但编译复杂 pattern 本身可能慢。
**建议**: 添加 pattern 长度限制（如 `len ≤ 200`）和编译超时。

### HIGH-03: `as any` 类型绕过

**范围**: `packages/core/src` 中有多处 `as any`，集中在:
- `sqlite.bun.ts` — SQL 参数传递 (params as any) — 合理
- `npm.ts` — typed JSON 解析 (pkg as any) — 合理但可改进
- `plugin/provider/` — provider 配置 (options as any) — 类型定义不完整

**影响**: `as any` 关闭了所有类型检查，可能隐藏类型错误。
**建议**: 逐步减少 `as any` 数量，优先修复 provider 配置的类型定义。

---

## 🟡 级别 3：中优先级

### MED-01: 遗留 TODO/FIXME 债务

全项目约 50+ TODO 标记，集中在:
- `packages/core/src/tool/bash.ts` — 6 个 TODO（V2 parser、progress、background job 等）
- `packages/core/src/tool/write.ts` — 4 个 TODO（formatter、watcher、snapshot、LSP）
- `packages/core/src/session/runner/` — 上游 V2 过渡注释
- `packages/opencode/src/provider/provider.ts` — 环境变量处理和 provider 特定假设

**建议**: 为每个 TODO 分配 issue 或标记 `#[deprecated]`。关键路径上的 TODO 优先解决。

### MED-02: 依赖过时

| 包 | 当前 | 最新 |
|---|------|------|
| oxlint | 1.60.0 | 1.72.0 |
| prettier | 3.6.2 | 3.9.4 |
| @actions/artifact | 5.0.1 | 6.2.1 |
| @aws-sdk/client-s3 | 3.933.0 | 3.1079.0 |
| @ai-sdk/provider | 3.0.8 | 3.0.13 |

**安全影响**: 低 — 无已知 CVE。但 oxlint 落后 12 个 minor 版本。
**建议**: `bun update` 批量升级。

### MED-03: Cargo.lock 包含已删 crate 的引用

Cargo.lock 仍包含 `opencode-x-prompt-builder`、`opencode-x-provider-proxy`、`opencode-x-shared-tiktoken`、`opencode-x-sqlite` 的依赖树 (194 deps 总量)。`cargo clean && cargo build` (仅 tool-exec) 后应缩减至 ~50 deps。

**建议**: `cargo clean && cargo build --manifest-path natives/tool-exec/Cargo.toml` 重建。

### MED-04: 已删 `token-counter` 的 `.zig-cache` 残留

`natives/token-counter/` 已删除，但 `.zig-cache/` 仍在文件系统（已在 `.gitignore`，不影响 git）。
**建议**: 清理：`rm -rf natives/token-counter/`（确认已执行）。

### MED-05: 无速率限制 / DOS 防护

所有 API 调用（LLM provider、工具执行）均无速率限制或并发控制。恶意/失控 agent 可能产生大量 API 请求。

**建议**: 在 HTTP 传输层添加并发控制（已有 semaphore 模式在 sqlite 层），考虑为 provider API 调用添加令牌桶。

---

## 🟢 级别 4：低优先级

### LOW-01: `bun audit` 不可用

`bun audit` 返回 404。缺少第三方依赖漏洞扫描能力。

### LOW-02: 缺少上游合并后验证脚本

当前无自动化检查确保上游合并后 fork 完整性。PLAN.md 描述的手动流程容易遗漏。

**建议**: 写 `scripts/post-merge-check.sh`，对比关键文件列表。

### LOW-03: `Cargo.toml` 残留 `glob = "0.3"` 依赖

`natives/tool-exec/Cargo.toml` 中 `glob` crate 已删除但曾误加回。已修复。

---

## ✅ 审计通过项

| 类别 | 结果 |
|------|------|
| 硬编码密钥/令牌 | ✅ 未发现 |
| Rust unsafe 块 | ✅ 0 处 |
| 命令注入 | ✅ 无拼接 shell 命令 |
| eval/Function/动态 require | ✅ 未使用 |
| 原型污染 / 批量赋值 | ✅ 无风险模式 |
| SSRF (用户控制 URL) | ✅ 无 fetch 回环 |
| 路径遍历 | ✅ 所有文件操作通过 `mutation.resolve()` |
| 工具输入验证 | ✅ 全部通过 `Schema.Struct` |
| 自制加密 | ✅ 未使用 |
| 剪贴板/通知滥用 | ✅ 未发现 |
| 混淆依赖 | ✅ 无 typosquatting |
| node_modules 体积 | ✅ 合理（最大 22MB typescript） |
| postinstall 脚本 | ✅ 仅 fix-node-pty（合法） |
| JSON.parse 安全 | ✅ 全部 try-catch 包裹 |

---

## 对抗审计总结

### 之前已执行的决策验证

| 审计项 | 原始假设 | 验证结论 |
|--------|---------|---------|
| Rust glob 6.8x vs ripgrep | 保留 Rust | ❌ 实际 2x 慢于 Bun.Glob → **已删** |
| Rust sqlite 默认驱动 | 保留 Rust | ❌ 实际 5.5x 慢于 bun:sqlite → **已删** |
| Rust prompt-builder | 保留 Rust | ❌ 实际 8x 慢于 TS join → **已删** |
| Rust tiktoken | 保留 Rust | ❌ 启发式亚微秒级完成 → **已删** |
| Rust SSE | 保留 Rust | ❌ 实际 5.4x 慢于 TS fetch → **已删** |
| Rust grep | 保留 Rust | ✅ async, ~10000x 快于 ripgrep spawn → **保留** |
| Agent Loop Rust 重写 | 不做 | ✅ 验证通过（Effect 编排是 TS 强项） |
| `*.node` 在 git | 未审核 | ❌ **需修复** — 2.6MB 二进制被跟踪 |
| TypeScript strict | 未审核 | ❌ **需修复** — 15/16 包无 strict mode |

### 架构风险评分 (1-10, 10=最危险)

| 风险 | 评分 | 说明 |
|------|------|------|
| 二进制构件 git 跟踪 | 7 | 2.6MB .node 被版本控制 |
| Staged 删除未提交 | 6 | 218 个删除 pending，合并冲突风险 |
| TS strict mode | 5 | null/undefined/any 未被编译器捕获 |
| TODO 债务 | 3 | 大部分是上游 V2 过渡注释 |
| Rust ReDoS | 2 | NFA regex 天然防护，复杂 pattern 仍需注意 |
| 过时依赖 | 2 | 无已知 CVE |
| 依赖总量 | 2 | opencode 114 deps + core 77 deps 偏大 |
| 无速率限制 | 3 | 缺少 API 调用并发控制 |
| 合并流程 | 3 | 无自动化验证脚本 |

### 结论

项目在**主动审计**后已删除 5/6 负价值 Rust 模块，在 **被动审计** 中发现两个严重问题（二进制 git 跟踪、staged 删除未提交）和若干中低风险项。整体安全基线较好——无硬编码密钥、无注入漏洞、工具输入全量 Schema 验证——但 TypeScript 配置偏宽松，依赖管理有改进空间。

主要行动项：
1. 立即修复 CRIT-01 和 CRIT-02
2. 按优先级逐步修复 HIGH/MED 项
3. 建立定期审计节奏（每季度）
