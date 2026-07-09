# OpenCode-X 安装指南

## 🍺 方法 1: Tap 安装（推荐）

如果你想使用 `brew upgrade` 自动更新：

```bash
# 1. 添加 tap（只需一次）
brew tap 3kaiu/opencode-x https://github.com/3kaiu/opencode-x.git

# 2. 安装
brew install opencodex

# 3. 后续升级
brew upgrade opencodex
```

### 方法 2: URL 直接安装

不需要先 tap，一次性安装：

```bash
brew install https://raw.githubusercontent.com/3kaiu/opencode-x/main/Formula/opencodex.rb
```

⚠️ 这种方式不支持 `brew upgrade` 自动更新，需要手动重新执行安装命令。

---

## 📦 直接下载

从 [Releases](https://github.com/3kaiu/opencode-x/releases) 下载对应平台的二进制文件，解压后放到 PATH 目录即可。

---

## 🔧 从源码构建

```bash
git clone https://github.com/3kaiu/opencode-x.git
cd opencode-x
bun install
bun run --cwd packages/opencode script/build.ts --skip-embed-web-ui --single --skip-install
```

构建产物位于 `packages/opencode/dist/opencode-{platform}/bin/opencodex`，手动链接到 PATH：

```bash
ln -sf $(pwd)/packages/opencode/dist/opencode-darwin-arm64/bin/opencodex /opt/homebrew/bin/opencodex
```

---

## 📝 Formula 维护

Homebrew formula 位于 `Formula/opencodex.rb`。

发布新版本时，需要更新 `version` 和对应平台的 `sha256` 校验和。
