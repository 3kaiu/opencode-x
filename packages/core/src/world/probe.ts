// V2 world perception — probe primitives (M2 §2.6).
// Low-token-cost direction finding: peek / symbols / imports / head.
// Design: token budget descending (50 / 100 / 50 / ~30 tokens).
export * as Probe from "./probe"

import { Effect } from "effect"
import { spawn } from "node:child_process"
import { promises as fs } from "node:fs"
import path from "node:path"

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

export interface TreeEntry {
  readonly name: string
  readonly type: "dir" | "file"
}

/** Directory tree preview, depth-limited. ~50 tokens for a small project. */
export const peek = Effect.fn("V2World.peek")(function* (dir: string, depth = 2, limit = 40) {
  const out = yield* Effect.promise(() =>
    run("find", [dir, "-maxdepth", String(depth), "-type", "f", "-o", "-type", "d"], 5_000),
  )
  if (!out) return []
  return out
    .split("\n")
    .filter((l) => l !== dir)
    .slice(0, limit)
    .map((l) => {
      const rel = l.slice(dir.length).replace(/^\//, "")
      return { name: rel, type: (l.endsWith("/") ? "dir" : "file") as "dir" | "file" }
    })
})

export interface SymbolEntry {
  readonly kind: string
  readonly name: string
  readonly file: string
  readonly line: number
}

/** Symbol table (functions/classes) for matching files. ~100 tokens. */
export const symbols = Effect.fn("V2World.symbols")(function* (root: string, glob: string, limit = 50) {
  const out = yield* Effect.promise(() => run("rg", ["-n", "--no-heading", "-e", "^\\s*(export\\s+)?(async\\s+)?(function|class|interface|type|const)\\s+[A-Za-z0-9_]+", root, "-g", glob], 5_000))
  if (!out) return [] as SymbolEntry[]
  return out
    .split("\n")
    .slice(0, limit)
    .map((line) => {
      const [file, lineNo, ...rest] = line.split(":")
      const text = rest.join(":")
      const m = text.match(/(function|class|interface|type|const)\s+([A-Za-z0-9_]+)/)
      return {
        kind: m?.[1] ?? "symbol",
        name: m?.[2] ?? text.trim().slice(0, 40),
        file: path.relative(root, file),
        line: Number(lineNo),
      } satisfies SymbolEntry
    })
})

/** Single-file import graph. ~50 tokens. */
export const imports = Effect.fn("V2World.imports")(function* (file: string, limit = 30) {
  const text = yield* Effect.promise(() => fs.readFile(file, "utf8").catch(() => ""))
  const lines = text.split("\n")
  const found: string[] = []
  for (const line of lines) {
    const m = line.match(/(?:import|export)\s+.*?from\s+["']([^"']+)["']/)
    if (m) found.push(m[1])
    if (found.length >= limit) break
  }
  return found
})

/** Fast head/tail read without loading the whole file. ~30 tokens each. */
export const head = Effect.fn("V2World.head")(function* (file: string, n = 20) {
  const text = yield* Effect.promise(() => fs.readFile(file, "utf8").catch(() => ""))
  return text.split("\n").slice(0, n).join("\n")
})

export const tail = Effect.fn("V2World.tail")(function* (file: string, n = 20) {
  const text = yield* Effect.promise(() => fs.readFile(file, "utf8").catch(() => ""))
  const lines = text.split("\n")
  return lines.slice(Math.max(0, lines.length - n)).join("\n")
})
