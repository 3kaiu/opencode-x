// V2 world perception — environment snapshot (M2 §2.6).
// Design source: kimi-code `<git-context>` block (parallel probes, 5s timeout,
// per-item degradation, remote URL sanitization).
export * as Snapshot from "./snapshot"

import { Effect } from "effect"
import { spawn } from "node:child_process"

export interface EnvSnapshot {
  readonly os: { platform: string; arch: string; shell: string | null }
  readonly cwd: string
  readonly packageManager: "bun" | "npm" | "pnpm" | "yarn" | null
  readonly git: {
    branch: string | null
    status: "clean" | "dirty" | "unknown"
    remoteURL: string | null
  }
  readonly keyPaths: { home: string; configDir: string; dataDir: string }
  readonly toolAvailability: Record<string, boolean>
  readonly capturedAt: number
}

const run = (cmd: string, args: string[], timeoutMs = 5_000): Promise<string | null> =>
  new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "ignore"], shell: false })
    let out = ""
    const timer = setTimeout(() => {
      child.kill("SIGKILL")
      resolve(null)
    }, timeoutMs)
    child.stdout.on("data", (chunk: Buffer) => {
      out += chunk.toString()
    })
    child.on("close", (code) => {
      clearTimeout(timer)
      resolve(code === 0 ? out.trim() : null)
    })
    child.on("error", () => {
      clearTimeout(timer)
      resolve(null)
    })
  })

const gitProbe = Effect.fnUntraced(function* (cwd: string) {
  const branch = yield* Effect.promise(() => run("git", ["branch", "--show-current"], 5_000))
  const status: "clean" | "dirty" | "unknown" = yield* Effect.promise(() =>
    run("git", ["status", "--porcelain"], 5_000).then((s) =>
      s === null ? "unknown" : s.length > 0 ? "dirty" : "clean",
    ),
  )
  const remote = yield* Effect.promise(() => run("git", ["remote", "get-url", "origin"], 5_000))
  return {
    branch,
    status,
    remoteURL: sanitizeRemote(remote),
  }
})

/** Remote URLs are injected into model context — strip credentials, keep origin host. */
export function sanitizeRemote(url: string | null): string | null {
  if (!url) return null
  try {
    if (url.startsWith("git@")) {
      const m = url.match(/^git@([^:]+):(.+)$/)
      return m ? `${m[1]}/${m[2]}` : null
    }
    const parsed = new URL(url)
    return `${parsed.host}${parsed.pathname}`
  } catch {
    return null
  }
}

export function detectPackageManager(cwd: string): "bun" | "npm" | "pnpm" | "yarn" | null {
  // Synchronous existence check (cheap, no spawn): lockfile presence.
  const fs = require("node:fs") as typeof import("node:fs")
  if (fs.existsSync(`${cwd}/bun.lock`) || fs.existsSync(`${cwd}/bun.lockb`)) return "bun"
  if (fs.existsSync(`${cwd}/pnpm-lock.yaml`)) return "pnpm"
  if (fs.existsSync(`${cwd}/yarn.lock`)) return "yarn"
  if (fs.existsSync(`${cwd}/package-lock.json`)) return "npm"
  return null
}

const availabilityProbe = Effect.fnUntraced(function* (commands: string[]) {
  const results = yield* Effect.forEach(commands, (cmd) =>
    Effect.promise(() => run("sh", ["-c", `command -v ${cmd}`], 3_000).then((r) => r !== null)),
  )
  return Object.fromEntries(commands.map((cmd, i) => [cmd, results[i]]))
})

export const capture = Effect.fn("V2World.capture")(function* (cwd: string) {
  const git = yield* gitProbe(cwd)
  const availability = yield* availabilityProbe(["git", "node", "bun", "npm", "pnpm", "jq", "rg"])
  return {
    os: {
      platform: process.platform,
      arch: process.arch,
      shell: process.env.SHELL ?? null,
    },
    cwd,
    packageManager: detectPackageManager(cwd),
    git,
    keyPaths: {
      home: process.env.HOME ?? "",
      configDir: process.env.XDG_CONFIG_HOME ?? `${process.env.HOME ?? ""}/.config`,
      dataDir: process.env.XDG_DATA_HOME ?? `${process.env.HOME ?? ""}/.local/share`,
    },
    toolAvailability: availability,
    capturedAt: Date.now(),
  } satisfies EnvSnapshot
})
