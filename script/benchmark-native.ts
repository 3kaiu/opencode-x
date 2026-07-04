#!/usr/bin/env bun
/**
 * Native vs TS/Bun 原生 Benchmark — 精简版
 * 聚焦回答：每个 Rust 模块值不值得保留？
 *
 * 原则：单个测量不超过 5s，优先跑 warm 数据（实际使用场景）
 */

interface Measure {
  module: string
  impl: string
  label: string
  avgMs: number
  note?: string
}

const measures: Measure[] = []
const failures: string[] = []

function bench(label: string, fn: () => void, rounds: number): number {
  for (let i = 0; i < Math.min(2, rounds); i++) fn()
  const start = performance.now()
  for (let i = 0; i < rounds; i++) fn()
  return (performance.now() - start) / rounds
}

async function benchAsync(label: string, fn: () => Promise<void>, rounds: number): Promise<number> {
  for (let i = 0; i < Math.min(2, rounds); i++) await fn()
  const start = performance.now()
  for (let i = 0; i < rounds; i++) await fn()
  return (performance.now() - start) / rounds
}

function ok(mod: string, impl: string, label: string, avgMs: number, note?: string) {
  measures.push({ module: mod, impl, label, avgMs, note })
}

function fail(mod: string, msg: string) {
  failures.push(`${mod}: ${msg}`)
}

// ── 1. prompt-builder ────────────────────────────────────

function benchPromptBuilder() {
  const mod = "prompt-builder"

  let rust: any = null
  try { rust = require("../packages/opencode/src/prompt-builder/index.node") } catch {}

  const tsJoin = () => {
    const parts = ["prompt", "env: date=2026-07-04", "instructions: be concise", "skills: code, debug"]
    return parts.join("\n")
  }

  const tsArr = () => {
    const parts = ["prompt", "env: date=2026-07-04", "instructions: be concise", "skills: code, debug"]
    return parts
  }

  // Rust assembleSystemPrompt with realistic args
  if (rust) {
    const args: [string | null, string, string, string[], string, string | null, boolean] = [
      "You are a helpful assistant.",
      "Provider: Anthropic",
      "Date: 2026-07-04\nDir: /home/user/project",
      ["Instruction: Be concise.", "Instruction: Use Chinese."],
      "Skills: code review, debugging",
      null, false,
    ]

    const t = bench(`Rust napi ×${ROUNDS.heavy}`, () => rust.assembleSystemPrompt(...args), ROUNDS.heavy)
    ok(mod, "Rust napi", "assembleSystemPrompt", t)
  }

  const tJoin = bench(`TS join ×${ROUNDS.heavy}`, tsJoin, ROUNDS.heavy)
  ok(mod, "TS join()", "string assembly", tJoin)

  // join of 100 lines
  const longLines = Array.from({ length: 100 }, (_, i) => `line_${i}: ` + "x".repeat(80))
  const tLongJoin = bench(`TS join long ×${ROUNDS.heavy}`, () => longLines.join("\n"), ROUNDS.heavy)
  ok(mod, "TS join()", "100-line assembly", tLongJoin)
}

// ── 2. SQLite ────────────────────────────────────────────

async function benchSqlite() {
  const mod = "sqlite"

  let RustDb: any = null
  try { RustDb = require("../packages/core/src/database/index.node").Database } catch {}
  const { default: BunDb } = await import("bun:sqlite")

  // --- warm cache test: single row ops ---
  const bunDb = new BunDb(":memory:")
  bunDb.run("CREATE TABLE IF NOT EXISTS t (id INTEGER PRIMARY KEY, name TEXT)")
  const bunInsert = bunDb.prepare("INSERT INTO t VALUES (?, ?)")
  const bunGet = bunDb.prepare("SELECT * FROM t WHERE id = ?")
  bunInsert.run(1, "hello")

  const tBunGet = bench("×10000", () => bunGet.get(1), 10000)
  ok(mod, "bun:sqlite", "SELECT by PK ×10000", tBunGet)

  // cleanup
  bunDb.close()

  // --- rusqlite ---
  if (RustDb) {
    const rDb = new RustDb(":memory:")
    rDb.exec("CREATE TABLE IF NOT EXISTS t (id INTEGER PRIMARY KEY, name TEXT)", [])
    rDb.exec("INSERT INTO t VALUES (1, 'hello')", [])
    const tRustGet = bench("×10000", () => rDb.queryAll("SELECT * FROM t WHERE id = ?", [1]), 10000)
    ok(mod, "rusqlite", "SELECT by PK ×10000", tRustGet)
  }

  // --- warm cache: bulk insert ---
  const bulkBun = new BunDb(":memory:")
  bulkBun.run("CREATE TABLE IF NOT EXISTS t (id INTEGER PRIMARY KEY, name TEXT)")
  const bulkInsert = bulkBun.prepare("INSERT INTO t VALUES (?, ?)")

  const tBunBulk = bench("×100", () => {
    bulkBun.run("DELETE FROM t")
    for (let i = 0; i < 100; i++) bulkInsert.run(i, `name_${i}`)
  }, 100)
  ok(mod, "bun:sqlite", "bulk INSERT 100 rows ×100", tBunBulk)
  bulkBun.close()

  if (RustDb) {
    const rBulk = new RustDb(":memory:")
    rBulk.exec("CREATE TABLE IF NOT EXISTS t (id INTEGER PRIMARY KEY, name TEXT)", [])
    const tRustBulk = bench("×100", () => {
      rBulk.exec("DELETE FROM t", [])
      for (let i = 0; i < 100; i++) rBulk.exec("INSERT INTO t VALUES (?, ?)", [i, `name_${i}`])
    }, 100)
    ok(mod, "rusqlite", "bulk INSERT 100 rows ×100", tRustBulk)
  }
}

// ── 3. Glob ──────────────────────────────────────────────

function benchGlob() {
  const mod = "glob"

  let rustGlob: any = null
  try { rustGlob = require("../packages/core/src/tool-exec/index.node").globFiles } catch {}

  const root = process.cwd()
  // Use specific directory to avoid node_modules traversal
  const patterns = ["*.ts", "**/*.ts"]

  const dirsToScan = [
    "packages/core/src",
    "packages/opencode/src",
  ]

  for (const dir of dirsToScan) {
    const absDir = `${root}/${dir}`

    if (rustGlob) {
      const r = bench(`×${ROUNDS.medium}`, () => rustGlob("**/*.ts", absDir), ROUNDS.medium)
      ok(mod, "Rust ignore", `"**/*.ts" in ${dir} ×${ROUNDS.medium}`, r)
    }

    // Bun.Glob
    try {
      const t = bench(`×${ROUNDS.medium}`, () => {
        const g = new Bun.Glob("**/*.ts")
        return [...g.scanSync({ cwd: absDir })]
      }, ROUNDS.medium)
      ok(mod, "Bun.Glob", `"**/*.ts" in ${dir} ×${ROUNDS.medium}`, t)
    } catch (e: any) {
      fail(mod, `Bun.Glob: ${e.message}`)
    }
  }
}

// ── 4. Grep ──────────────────────────────────────────────

function benchGrep() {
  const mod = "grep"

  let rustGrep: any = null
  try { rustGrep = require("../packages/core/src/tool-exec/index.node").grepFiles } catch {}

  const searches = [
    { pattern: "Effect", dir: "packages/core/src", include: "*.ts" },
    { pattern: "function\\s+\\w+", dir: "packages/core/src", include: "*.ts" },
    { pattern: "import", dir: "packages/opencode/src", include: "*.ts" },
  ]

  // TS: ripgrep subprocess
  const rgGrep = (pattern: string, cwd: string, include?: string): string[] => {
    const { execFileSync } = require("child_process")
    const args = [pattern, cwd, "--no-heading", "-n"]
    if (include) args.push("-g", include)
    const out = execFileSync("rg", args, { encoding: "utf-8", maxBuffer: 10 * 1024 * 1024, timeout: 5000 })
    return out.trim().split("\n").filter(Boolean)
  }

  for (const { pattern, dir, include } of searches) {
    const absDir = `${process.cwd()}/${dir}`

    if (rustGrep) {
      const t = bench(`×${ROUNDS.medium}`, () => rustGrep(pattern, absDir, include, 1000), ROUNDS.medium)
      ok(mod, "Rust regex", `"${pattern}" in ${dir} ×${ROUNDS.medium}`, t)
    }

    // ripgrep subprocess: cold start (first call includes spawn + FS cache)
    const rgTime = bench(`×${ROUNDS.medium}`, () => rgGrep(pattern, absDir, include), ROUNDS.medium)
    ok(mod, "ripgrep subprocess", `"${pattern}" in ${dir} ×${ROUNDS.medium}`, rgTime)
  }

  // Cold start measurement: first call only
  console.log("\n   Cold start (first call after idle):")
  const { execFileSync } = require("child_process")
  for (const { pattern, dir, include } of searches) {
    const absDir = `${process.cwd()}/${dir}`

    if (rustGrep) {
      // Force new process isolation — can't truly cold-boot napi, but measure first call
      const start = performance.now()
      rustGrep(pattern, absDir, include, 10) // small limit for speed
      const rustFirst = performance.now() - start
      console.log(`   Rust regex "${pattern}": first call ${rustFirst.toFixed(3)} ms`)
    }

    // ripgrep cold: each execFileSync IS a cold spawn
    const rgColdStart = performance.now()
    try {
      execFileSync("rg", [pattern, absDir, "--no-heading", "-n", "-g", include ?? "*.ts"], { encoding: "utf-8", maxBuffer: 1024 * 1024, timeout: 5000 })
    } catch {}
    const rgCold = performance.now() - rgColdStart
    console.log(`   ripgrep "${pattern}": cold spawn ${rgCold.toFixed(3)} ms`)
  }
}

// ── 5a. SSE: Rust reqwest vs TS fetch ───────────────────

async function benchSse() {
  const mod = "sse"

  let rustSse: any = null
  try {
    const m = require("../packages/opencode/src/provider-proxy/index.node")
    rustSse = m.streamSse
  } catch {}

  // Start mock SSE server
  const server = Bun.serve({
    port: 19000,
    async fetch(req) {
      // Simulate 50 events with realistic delay
      return new Response(
        new ReadableStream({
          async start(controller) {
            for (let i = 0; i < 50; i++) {
              controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ id: i, text: "x".repeat(20) })}\n\n`))
            }
            controller.close()
          },
        }),
        { headers: { "content-type": "text/event-stream", "cache-control": "no-cache" } },
      )
    },
  })

  const url = "http://localhost:19000"

  // Rust SSE
  if (rustSse) {
    const doRust = () =>
      new Promise<number>((resolve, reject) => {
        let count = 0
        const t = setTimeout(() => reject(new Error("timeout")), 5000)
        rustSse(
          { url, method: "GET", headers: [], body: "", timeoutMs: 5000, maxRetries: 0 },
          (_err: any, e: any) => { if (e?.data) count++ },
          (e: any) => { clearTimeout(t); reject(e) },
          () => { clearTimeout(t); resolve(count) },
        )
      })

    // warmup
    try { await doRust() } catch {}
    const r = await benchAsync(`×${ROUNDS.quick}`, doRust, ROUNDS.quick)
    ok(mod, "Rust reqwest", `50-events SSE ×${ROUNDS.quick}`, r)
  }

  // TS fetch
  const doTs = async () => {
    const resp = await fetch(url)
    const reader = resp.body!.getReader()
    const decoder = new TextDecoder()
    let count = 0
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      count += decoder.decode(value, { stream: true }).split("\n").filter((l) => l.startsWith("data: ")).length
    }
    return count
  }

  // warmup
  try { await doTs() } catch {}
  const t = await benchAsync(`×${ROUNDS.quick}`, doTs, ROUNDS.quick)
  ok(mod, "TS fetch", `50-events SSE ×${ROUNDS.quick}`, t)

  server.stop()
}

// ── 5. Token counter ─────────────────────────────────────

function benchTokenCounter() {
  const mod = "token-counter"

  let rustCount: ((t: string) => number) | null = null
  try {
    const m = require("../packages/core/src/util/index.node")
    rustCount = m.countTokens
  } catch {}

  const testTexts = [
    ["short", "Hello, world! This is a test."],
    ["medium", "The quick brown fox jumps over the lazy dog. ".repeat(20) + "中文测试文本".repeat(10)],
    ["long", ("function fibonacci(n: number): number {\n  if (n <= 1) return n\n  return fibonacci(n - 1) + fibonacci(n - 2)\n}\n").repeat(50)],
  ]

  for (const [name, text] of testTexts) {
    if (rustCount) {
      const t = bench(`×${ROUNDS.heavy}`, () => rustCount!(text), ROUNDS.heavy)
      ok(mod, "Rust tiktoken", `"${name}" ${text.length}chars ×${ROUNDS.heavy}`, t)
    }

    const tHeur = bench(`×${ROUNDS.heavy}`, () => Math.max(0, Math.round(text.length / 4)), ROUNDS.heavy)
    ok(mod, "TS heuristic", `"${name}" ×${ROUNDS.heavy}`, tHeur)

    const tUtf8 = bench(`×${ROUNDS.heavy}`, () => new TextEncoder().encode(text).length, ROUNDS.heavy)
    ok(mod, "TS TextEncoder", `"${name}" ×${ROUNDS.heavy}`, tUtf8)
  }

  // Accuracy
  console.log("\n   Accuracy:")
  for (const [name, text] of testTexts) {
    const a = rustCount ? rustCount(text) : -1
    const b = Math.max(0, Math.round(text.length / 4))
    const c = new TextEncoder().encode(text).length
    console.log(`   ${name.padEnd(8)} tiktoken=${a}  heuristic=${b}  utf8bytes=${c}  (heuristic err=${a > 0 ? Math.round(Math.abs(a-b)/a*100) : '?'}%)`)
  }
}

// ── Main ─────────────────────────────────────────────────

const ROUNDS = { quick: 10, medium: 100, heavy: 1000 }

async function main() {
  console.log("=".repeat(65))
  console.log("Native vs TS Benchmark")
  console.log(`Bun: ${process.version} | Arch: ${process.arch}`)
  console.log("=".repeat(65))

  console.log("\n## 1. prompt-builder")
  benchPromptBuilder()

  console.log("\n## 2. SQLite")
  await benchSqlite()

  console.log("\n## 3. Glob")
  benchGlob()

  console.log("\n## 4. Grep")
  benchGrep()

  console.log("\n## 5. SSE")
  await benchSse()

  console.log("\n## 6. Token Counter")
  benchTokenCounter()

  // ── Summary ──
  console.log("\n" + "=".repeat(65))
  console.log("Summary (avg ms per operation, lower is better)")
  console.log("=".repeat(65))

  interface SummaryGroup {
    module: string
    impl: string
    label: string
    avgMs: number
  }

  const grouped = new Map<string, SummaryGroup[]>()
  for (const m of measures) {
    const key = `${m.module}::${m.label}`
    if (!grouped.has(key)) grouped.set(key, [])
    grouped.get(key)!.push({ module: m.module, impl: m.impl, label: m.label, avgMs: m.avgMs })
  }

  for (const [key, items] of grouped) {
    const fastest = items.reduce((a, b) => (a.avgMs < b.avgMs ? a : b))
    console.log(`\n  ${key}:`)
    for (const item of items) {
      const ratio = fastest.avgMs > 0 ? (item.avgMs / fastest.avgMs).toFixed(2) : "-"
      const tag = item === fastest ? " ← BEST" : ` (${ratio}x slower)`
      console.log(`    ${item.impl.padEnd(20)} ${item.avgMs.toFixed(4).padStart(10)} ms${tag}`)
    }
  }

  if (failures.length > 0) {
    console.log("\n  Failures:")
    for (const f of failures) console.log(`    ❌ ${f}`)
  }

  console.log("\n" + "=".repeat(65))
  console.log(`Done. ${measures.length} measurements, ${failures.length} failures`)
}

main()
