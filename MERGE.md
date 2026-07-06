# Merge 策略

## 背景

opencode-x 是基于 [anomalyco/opencode](https://github.com/anomalyco/opencode) 的 fork，需要定期合并上游更新。

## 远程配置

```bash
git remote add upstream https://github.com/anomalyco/opencode.git
git fetch upstream
```

## 合并流程

```bash
git fetch upstream
git merge --no-edit upstream/dev
```

## 冲突分类与处理策略

| 冲突来源 | 频率 | 处理方式 |
|---------|------|---------|
| `packages/app/`, `packages/desktop/`, 等已删包 | 每次 | `git rm --cached` 保留删除 |
| `packages/opencode/src/{acp,sync,share}/`, `cli/cmd/{github.*,pr,web,acp,import}.ts`, `server/mdns.ts` | 每次 | `git rm` 保留删除（个人定位剔除） |
| `bun.lock` | 中 | `bun install` 重新生成 |
| `package.json` (workspaces) | 低 | 手动合入，保持 `packages/*` workspace 不变 |
| `packages/opencode/package.json` (依赖) | 中 | 手动合入，保留 opencode-x 特有依赖；已删 `@actions/*`、`@octokit/*`、`@agentclientprotocol/*`、`bonjour-service`、`chokidar`、`@gitlab/opencode-gitlab-auth` |
| `packages/core/package.json` (依赖版本) | 中 | 手动合入，保留 opencode-x 特有依赖 |
| `packages/core/src/observability.ts` | 低 | 保留 `Layer.empty` 修复 |
| `packages/llm/src/route/transport/http.ts` | 低 | 保留 Rust SSE 注入 |
| `packages/opencode/src/index.ts` (cmd 注册) | 中 | 手动合入，保持已删命令的注册移除 |
| `packages/opencode/src/server/server.ts` (mdns 移除) | 低 | 保留 mdns/setupMdns 移除 |
| `packages/opencode/src/server/routes/instance/httpapi/handlers/session.ts` (share/unshare 移除) | 中 | 保留 share/unshare handler 和 SessionShare import 移除 |
| `packages/opencode/src/server/routes/instance/httpapi/groups/session.ts` (share/unshare endpoint 移除) | 中 | 保留 share/unshare endpoint 和 SessionPaths.share 移除 |
| `packages/opencode/src/cli/cmd/run.ts` (--share 选项移除) | 中 | 保留 --share 选项和 share() 函数移除 |
| `packages/opencode/src/effect/{app-runtime,bootstrap-runtime,runtime-flags}.ts` (share layer 移除) | 中 | 保留 ShareNext/SessionShare/autoShare 移除 |
| TS 壳接口签名变化 | 低 | 同步更新 TS 壳 |
| 上游新增工具协议 | 中 | 可选添加 Rust 实现 |

### 已删包列表（合并时自动处理）

以下包在 opencode-x 中已删除，合并时会出现 `modify/delete` 冲突：
- `packages/app/`
- `packages/desktop/`
- `packages/slack/`
- `packages/enterprise/`
- `packages/web/`
- `packages/function/`
- `packages/http-recorder/`
- `packages/httpapi-codegen/`
- `packages/console/`
- `packages/stats/`
- `packages/storybook/`
- `packages/containers/`
- `packages/identity/`

处理方式：`git rm <file>` 保留删除。

## 合并后验证

```bash
bun install
bun run build:all
bun run --cwd packages/core typecheck
bun run --cwd packages/opencode typecheck
bun run --cwd packages/llm typecheck
bun run --cwd packages/opencode --conditions=browser ./src/index.ts --version
```