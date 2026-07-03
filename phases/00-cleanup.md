# Phase 0: Fork + 清理 + 基础设施

**目标**: 基于 upstream v1.17.13 建立 fork，清除无用代码，搭好多语言构建骨架。

## 任务列表

### 0.1 Fork 并固定版本
- [ ] `cd /Users/seeu/self/opencode-x && git init`
- [ ] `git remote add upstream https://github.com/anomalyco/opencode.git`
- [ ] `git fetch --tags upstream`
- [ ] `git checkout -b main v1.17.13`

### 0.2 删除无用包
- [ ] `packages/app/` — Web 应用（包含 Sentry）
- [ ] `packages/desktop/` — Electron 桌面版
- [ ] `packages/slack/` — Slack 集成
- [ ] `packages/enterprise/` — 企业功能
- [ ] `packages/web/` — Web UI
- [ ] `packages/codemode/` — 代码模式
- [ ] `packages/function/` — 函数功能
- [ ] `packages/http-recorder/` — HTTP 录制
- [ ] `packages/httpapi-codegen/` — API 代码生成
- [ ] `packages/server/` — 后端服务（保留判断）

### 0.3 删除遥测代码
- [ ] 删除 `packages/app/` 中的 Sentry 初始化（已随包删除）
- [ ] 删除 `packages/desktop/` 中的 Sentry（已随包删除）
- [ ] 删除 OpenTelemetry 配置: `packages/core/src/observability/otlp.ts`
- [ ] 删除 `experimental_telemetry` 相关代码: `packages/opencode/src/session/llm.ts`
- [ ] 删除 `packages/opencode/src/agent/agent.ts` 中的 telemetry 引用
- [ ] 清理 `package.json` 中的 sentry/otel 依赖

### 0.4 搭建目录结构
- [ ] 创建 `natives/` 目录
- [ ] 创建 `natives/Cargo.toml` (workspace)
- [ ] 创建 `natives/token-counter/` (Zig WASM)
- [ ] 创建 `natives/shared/` (Rust 共享库)
- [ ] 创建 `.upstream/` 目录（上游镜像参考）

### 0.5 配置 Bun
- [ ] 安装 Bun (如未安装)
- [ ] 测试 `bun install` 在剩余包上能否通过
- [ ] 修复兼容性问题
- [ ] 配置 `bun run dev` 启动（指向 cli 或 tui）

### 0.6 配置 Rust 构建
- [ ] 安装 Rust + wasm-pack (如未安装)
- [ ] 创建 `natives/Cargo.toml` workspace
- [ ] 创建 `natives/shared/Cargo.toml` 并配置 napi-rs
- [ ] 验证 `cargo build` 通过

### 0.7 配置 Zig WASM 构建
- [ ] 安装 Zig (如未安装)
- [ ] 创建 `natives/token-counter/build.zig`
- [ ] 实现一个简单 WASM 导出函数
- [ ] 验证 `zig build` 生成 .wasm

### 0.8 验证
- [ ] 剩余包 `bun run build:ts` 通过
- [ ] `cargo build` 通过
- [ ] `zig build` 通过
- [ ] 基本 CLI 命令能启动

### 0.9 设置 CI
- [ ] `.github/workflows/ci.yml` — TS lint + Rust build + Zig build

### 0.10 测试合并流程
- [ ] `git remote add upstream` 配置
- [ ] 手动测试 `git merge upstream/dev` 确认没有意外冲突
