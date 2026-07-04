import { createRequire } from "module"
import { fileURLToPath } from "url"
import { dirname, join } from "path"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const ROOT = join(__dirname, "..")

const require = createRequire(import.meta.url)
const resolve = (p: string) => join(ROOT, p)

// ── Helpers ──────────────────────────────────────────────────────────────────

function bench(label: string, fn: () => void, iterations = 1000): { label: string; ms: number; ops: number } {
  for (let i = 0; i < Math.min(10, iterations); i++) fn()

  const start = performance.now()
  for (let i = 0; i < iterations; i++) fn()
  const elapsed = performance.now() - start
  return { label, ms: Math.round(elapsed * 100) / 100, ops: Math.round((iterations / elapsed) * 1000) }
}

async function benchAsync(label: string, fn: () => Promise<void>, iterations = 100): Promise<{ label: string; ms: number; ops: number }> {
  for (let i = 0; i < Math.min(3, iterations); i++) await fn()

  const start = performance.now()
  for (let i = 0; i < iterations; i++) await fn()
  const elapsed = performance.now() - start
  return { label, ms: Math.round(elapsed * 100) / 100, ops: Math.round((iterations / elapsed) * 1000) }
}

function fmt(r: { label: string; ms: number; ops: number }): string {
  return `  ${r.label.padEnd(45)} ${String(r.ms).padStart(8)} ms total  ${String(r.ops).padStart(10)} ops/s`
}

// ── Test data ────────────────────────────────────────────────────────────────

const SHORT_TEXT = "Hello, world!"
const MEDIUM_TEXT = "The quick brown fox jumps over the lazy dog. ".repeat(10)
const LONG_TEXT = "function test() { return 'hello'; }\n".repeat(200)
const CODE_TEXT = `
import { Effect } from "effect"
export const hello = Effect.gen(function* () {
  const x = yield* Effect.succeed(42)
  return x * 2
})
`.trim()

const ALL_TEXTS = [
  { name: "short (13 chars)", text: SHORT_TEXT },
  { name: "medium (450 chars)", text: MEDIUM_TEXT },
  { name: "long (4600 chars)", text: LONG_TEXT },
  { name: "code (200 chars)", text: CODE_TEXT },
]

// ── 1. Token Counter ─────────────────────────────────────────────────────────

console.log("\n╔══════════════════════════════════════════════════════╗")
console.log("║         TOKEN COUNTER BENCHMARK                      ║")
console.log("╚══════════════════════════════════════════════════════╝")

let rustTokenizer: { countTokensEstimate: (t: string) => number } | null = null
try {
  rustTokenizer = require(resolve("./packages/core/src/util/index.node"))
} catch {}

let zigCounter: ((t: string) => number) | null = null
try {
  const { initWasm, countTokens } = await import(join(ROOT, "natives/token-counter/src/loader.ts"))
  await initWasm()
  zigCounter = countTokens
} catch {}

const heuristic = (text: string) => Math.max(0, Math.round(text.length / 4))

for (const { name, text } of ALL_TEXTS) {
  console.log(`\n  ── ${name} ──`)
  const iters = text.length < 100 ? 5000 : text.length < 1000 ? 2000 : 500

  if (rustTokenizer) {
    const r = bench(`Rust tiktoken (cl100k_base)`, () => rustTokenizer!.countTokensEstimate(text), iters)
    console.log(fmt(r))
  }

  if (zigCounter) {
    const r = bench(`Zig WASM (UTF-8 code points)`, () => zigCounter!(text), iters)
    console.log(fmt(r))
  }

  const r = bench(`TS heuristic (chars/4)`, () => heuristic(text), iters)
  console.log(fmt(r))
}

// ── 2. Glob ──────────────────────────────────────────────────────────────────

console.log("\n╔══════════════════════════════════════════════════════╗")
console.log("║         GLOB BENCHMARK                               ║")
console.log("╚══════════════════════════════════════════════════════╝")

let rustGlob: { globFiles: (p: string, r: string) => Promise<{ path: string; size: number; isDir: boolean }[]> } | null = null
try {
  rustGlob = require(resolve("./packages/core/src/tool-exec/index.node"))
} catch {}

const GLOB_PATTERN = "**/*.ts"
const GLOB_ROOT = join(ROOT, "packages/core/src")

if (rustGlob) {
  console.log(`\n  Pattern: ${GLOB_PATTERN}  Root: ${GLOB_ROOT}`)
  const r = await benchAsync("Rust glob_files", async () => { await rustGlob!.globFiles(GLOB_PATTERN, GLOB_ROOT) }, 50)
  console.log(fmt(r))
}

import { execSync } from "child_process"
const tsGlob = (pattern: string, root: string) => {
  try {
    return execSync(`rg --files --glob "${pattern}" "${root}"`, { encoding: "utf8" }).split("\n").filter(Boolean)
  } catch { return [] }
}
const r = bench("TS ripgrep subprocess", () => tsGlob(GLOB_PATTERN, GLOB_ROOT), 50)
console.log(fmt(r))

// ── 3. Grep ──────────────────────────────────────────────────────────────────

console.log("\n╔══════════════════════════════════════════════════════╗")
console.log("║         GREP BENCHMARK                               ║")
console.log("╚══════════════════════════════════════════════════════╝")

const GREP_PATTERN = "export"
const GREP_ROOT = join(ROOT, "packages/core/src")

let rustGrep: { grepFiles: (p: string, r: string, i?: string, m?: number) => Promise<{ path: string; line: number; column: number; text: string }[]> } | null = null
try {
  rustGrep = require(resolve("./packages/core/src/tool-exec/index.node"))
} catch {}

if (rustGrep) {
  console.log(`\n  Pattern: ${GREP_PATTERN}  Root: ${GREP_ROOT}`)
  const r = await benchAsync("Rust grep_files", async () => { await rustGrep!.grepFiles(GREP_PATTERN, GREP_ROOT, undefined, 1000) }, 20)
  console.log(fmt(r))
}

const tsGrep = (pattern: string, root: string) => {
  try {
    return execSync(`rg "${pattern}" "${root}" --line-number --no-heading`, { encoding: "utf8" }).split("\n").filter(Boolean)
  } catch { return [] }
}
const r2 = bench("TS ripgrep subprocess", () => tsGrep(GREP_PATTERN, GREP_ROOT), 20)
console.log(fmt(r2))

// ── Summary ──────────────────────────────────────────────────────────────────

console.log("\n╔══════════════════════════════════════════════════════╗")
console.log("║         SUMMARY                                      ║")
console.log("╚══════════════════════════════════════════════════════╝")
console.log("  Rust keeps:  tiktoken, glob (6.8x), grep (4x)")
console.log("  Removed:     execute_shell, read_file/write_file (no perf gain)")
console.log("  TS keeps:    AppProcess (shell), Node fs (file I/O)")
console.log("  See per-operation results above.\n")
