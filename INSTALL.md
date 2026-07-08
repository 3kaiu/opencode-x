# OpenCode-X 安装指南

## 🍺 Homebrew 安装（推荐）

### 方法 1: URL 直接安装

```bash
brew install https://raw.githubusercontent.com/3kaiu/opencode-x/main/Formula/opencodex.rb
opencodex --version
```

### 方法 2: Tap 安装（传统方式）

如果你想使用 `brew upgrade` 自动更新：

```bash
# 1. 添加 tap
brew tap 3kaiu/opencode-x https://github.com/3kaiu/opencode-x.git

# 2. 安装
brew install opencode-x/opencode-x/opencodex

# 3. 更新
brew upgrade opencodex
```

---

## 📦 其他安装方式

### 直接下载

从 [Releases](https://github.com/3kaiu/opencode-x/releases) 下载对应平台的二进制文件。

---

## 🔧 从源码构建

```bash
git clone https://github.com/3kaiu/opencode-x.git
cd opencode-x
bun install
bun run --cwd packages/opencode script/build.ts --skip-embed-web-ui --single --skip-install
```

---

## 📝 Formula 维护

Homebrew formula 位于 `Formula/opencodex.rb`。

发布新版本时，需要更新 `version` 和对应平台的 `sha256` 校验和。
