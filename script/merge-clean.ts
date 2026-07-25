#!/usr/bin/env bun
// Upstream merge cleanup, driven by the MERGE.md deletion manifest.
//
// After `git merge upstream/dev`, upstream re-adds files this fork deletes
// (removed packages, CLI-only trimmed modules, orphan commands). This script
// re-applies those deletions path-by-path (never blanket `git rm`), audits
// banned dependencies, and scans for residual wiring that needs manual edits.
//
// Usage:
//   bun script/merge-clean.ts          # delete manifest paths + report
//   bun script/merge-clean.ts --check  # report only, no deletions
//
// Exit code is non-zero when banned deps or residual wiring remain, so it can
// gate the post-merge checklist in MERGE.md.

import { $ } from "bun"
import path from "path"

const root = path.resolve(import.meta.dir, "..")
const check = process.argv.includes("--check")

// Packages removed by the fork (MERGE.md "已删包列表").
const removedPackages = [
  "packages/app",
  "packages/desktop",
  "packages/session-ui",
  "packages/slack",
  "packages/enterprise",
  "packages/web",
  "packages/function",
  "packages/console",
  "packages/stats",
  "packages/containers",
  "packages/identity",
  "packages/storybook",
  "packages/httpapi-codegen",
  "packages/docs",
  "packages/ui",
  "packages/cli",
  "packages/client",
  "packages/sdk-next",
  "packages/native-bridge",
  "packages/script",
]

// CLI-only trim inside packages/opencode plus core-side cloud/telemetry pulls (MERGE.md 冲突表).
const removedOpencodePaths = [
  "packages/opencode/src/acp",
  "packages/opencode/src/account",
  "packages/opencode/src/share",
  "packages/opencode/src/sync",
  "packages/opencode/src/plugin/github-copilot",
  "packages/opencode/src/server/mdns.ts",
  "packages/opencode/src/cli/cmd/acp.ts",
  "packages/opencode/src/cli/cmd/github.ts",
  "packages/opencode/src/cli/cmd/github.handler.ts",
  "packages/opencode/src/cli/cmd/github.shared.ts",
  "packages/opencode/src/cli/cmd/pr.ts",
  "packages/opencode/src/cli/cmd/web.ts",
  "packages/opencode/src/cli/cmd/import.ts",
  "packages/opencode/test/acp",
  "packages/opencode/test/cli/acp",
  "packages/opencode/test/cli/import.test.ts",
  "packages/opencode/test/cli/github-remote.test.ts",
  "packages/opencode/test/cli/github-action.test.ts",
  "packages/opencode/test/share",
  "packages/opencode/test/server/httpapi-mdns.test.ts",
  "packages/core/src/github-copilot",
  "packages/core/src/oauth",
  "packages/core/src/observability/otlp.ts",
  "packages/core/src/plugin/provider/amazon-bedrock.ts",
  "packages/core/src/plugin/provider/cloudflare-ai-gateway.ts",
  "packages/core/src/plugin/provider/cloudflare-workers-ai.ts",
  "packages/core/test/plugin/provider-amazon-bedrock.test.ts",
  "packages/core/test/plugin/provider-cloudflare-ai-gateway.test.ts",
  "packages/core/test/plugin/provider-cloudflare-workers-ai.test.ts",
  "packages/opencode/src/plugin/cloudflare.ts",
]

// Dependencies the fork keeps out of packages/opencode/package.json.
// `opencode-gitlab-auth` (unscoped) stays; only the @gitlab/ scoped one is banned.
const bannedDeps = [
  "@actions/core",
  "@actions/github",
  "@agentclientprotocol/sdk",
  "@gitlab/opencode-gitlab-auth",
  "@octokit/graphql",
  "@octokit/rest",
  "@octokit/webhooks-types",
  "bonjour-service",
  "chokidar",
]

// Residual wiring patterns that require manual unwiring when they reappear.
// Scope is source dirs only; schema/DB-compat re-exports are allowlisted:
//   - packages/opencode/src/storage/schema.ts keeps SessionShareTable (DB compat)
//   - packages/core config schema keeps the server.mdns key (lenient parsing)
const residualScans = [
  { pattern: 'from "@/(acp|share|sync)', paths: ["packages/opencode/src"] },
  { pattern: "ShareNext|SessionShare\\.", paths: ["packages/opencode/src"] },
  { pattern: "[mM]dns", paths: ["packages/opencode/src"] },
  { pattern: "session\\.(share|unshare)\\(", paths: ["packages/opencode/src", "packages/tui/src"] },
  { pattern: '"session\\.(share|unshare)"', paths: ["packages/tui/src"] },
]
const residualAllowlist = ["packages/opencode/src/storage/schema.ts"]

async function main() {
  const deleted = await removeManifestPaths()
  const bannedFound = await auditDependencies()
  const residuals = await scanResiduals()

  if (deleted.length) console.log(`\n${check ? "would delete" : "deleted"} ${deleted.length} path(s)`)
  if (!bannedFound.length && !residuals.length) {
    console.log("clean: no banned deps, no residual wiring")
    return
  }
  console.log("\nmanual follow-up required:")
  bannedFound.forEach((dep) => console.log(`  - remove dependency ${dep} from packages/opencode/package.json`))
  residuals.forEach((line) => console.log(`  - unwire: ${line}`))
  process.exitCode = 1
}

async function removeManifestPaths() {
  const targets = [...removedPackages, ...removedOpencodePaths]
  const existing: string[] = []
  for (const target of targets) {
    const found = await $`git -C ${root} ls-files -- ${target}`.text()
    if (found.trim() === "") continue
    existing.push(target)
    console.log(`${check ? "[check] would git rm" : "git rm"} ${target}`)
    if (!check) await $`git -C ${root} rm -r -q -- ${target}`
  }
  return existing
}

async function auditDependencies() {
  const pkg = (await Bun.file(path.join(root, "packages/opencode/package.json")).json()) as {
    dependencies?: Record<string, string>
    devDependencies?: Record<string, string>
  }
  const declared = { ...pkg.dependencies, ...pkg.devDependencies }
  return bannedDeps.filter((dep) => dep in declared)
}

async function scanResiduals() {
  const lines: string[] = []
  for (const scan of residualScans) {
    const result = await $`git -C ${root} grep -nE ${scan.pattern} -- ${scan.paths}`.nothrow().quiet()
    if (result.exitCode !== 0) continue
    const hits = result
      .text()
      .split("\n")
      .filter((line) => line !== "")
      .filter((line) => !residualAllowlist.some((allowed) => line.startsWith(allowed + ":")))
    lines.push(...hits)
  }
  return lines
}

await main()
