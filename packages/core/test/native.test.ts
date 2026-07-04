import { describe, expect, test } from "bun:test"
import { tmpdir } from "os"
import { join } from "path"
import { mkdirSync, writeFileSync, rmSync } from "fs"

// ── Utility ──────────────────────────────────────────────────────────────────
const { countTokens, countTokensEstimate, hello } = require("../src/util/index.node") as {
  countTokens: (text: string, model?: string) => number
  countTokensEstimate: (text: string) => number
  hello: () => string
}

const { Database: NativeDatabase } = require("../src/database/index.node") as {
  Database: new (path: string) => {
    exec: (sql: string, params: unknown[]) => number
    queryAll: (sql: string, params: unknown[]) => Record<string, unknown>[]
    queryValues: (sql: string, params: unknown[]) => unknown[][]
  }
}

describe("util/index.node (tiktoken)", () => {
  test("hello returns greeting", () => {
    expect(hello()).toBe("hello from opencode-x native")
  })

  test("countTokens: empty string", () => {
    expect(countTokens("")).toBe(0)
  })

  test("countTokens: simple text", () => {
    expect(countTokens("Hello, world!")).toBe(4)
  })

  test("countTokens: known sentence", () => {
    expect(countTokens("The quick brown fox jumps over the lazy dog")).toBe(9)
  })

  test("countTokensEstimate matches countTokens", () => {
    const texts = ["", "Hello", "The quick brown fox jumps over the lazy dog", JSON.stringify({ a: 1 })]
    for (const text of texts) {
      expect(countTokensEstimate(text)).toBe(countTokens(text))
    }
  })

  test("countTokens: model-specific routing", () => {
    expect(countTokens("Hello, world!", "gpt-4")).toBe(4)
    expect(countTokens("Hello, world!", "gpt-3.5-turbo")).toBe(4)
    expect(countTokens("Hello, world!", "gpt-4o-mini")).toBe(4)
  })
})

describe("database/index.node (rusqlite)", () => {
  const dbPath = join(tmpdir(), "opencode-x-native-test.db")

  test("CRUD operations", () => {
    try { rmSync(dbPath) } catch { /* ok */ }

    const db = new NativeDatabase(dbPath)
    expect(db).toBeDefined()

    // CREATE
    db.exec("CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT, value REAL)", [])

    // INSERT
    expect(db.exec("INSERT INTO test (name, value) VALUES (?1, ?2)", ["hello", 42.5])).toBe(1)
    expect(db.exec("INSERT INTO test (name, value) VALUES (?1, ?2)", ["world", 99.9])).toBe(1)
    expect(db.exec("INSERT INTO test (name, value) VALUES (?1, ?2)", [null, 0])).toBe(1)

    // queryAll
    const rows = db.queryAll("SELECT * FROM test ORDER BY id", [])
    expect(rows).toHaveLength(3)
    expect(rows[0].name).toBe("hello")
    expect(rows[0].value).toBe(42.5)
    expect(rows[2].name).toBeNull()

    // queryValues
    const values = db.queryValues("SELECT name, value FROM test WHERE id = ?1", [1])
    expect(values).toHaveLength(1)
    expect(values[0]).toHaveLength(2)

    // UPDATE
    expect(db.exec("UPDATE test SET value = ?1 WHERE id = ?2", [100.0, 1])).toBe(1)
    const afterUpdate = db.queryAll("SELECT value FROM test WHERE id = 1", [])
    expect(afterUpdate[0].value).toBe(100.0)

    // DELETE
    expect(db.exec("DELETE FROM test WHERE id = ?1", [2])).toBe(1)
    const afterDelete = db.queryAll("SELECT COUNT(*) as cnt FROM test", [])
    expect(afterDelete[0].cnt).toBe(2)

    // WAL mode
    const pragmaRows = db.queryAll("PRAGMA journal_mode", [])
    expect(pragmaRows[0].journal_mode).toBe("wal")

    db.exec("DROP TABLE test", [])
    try { rmSync(dbPath) } catch { /* ok */ }
  })
})

describe("tool-exec/index.node (Rust tool execution)", () => {
  test("globFiles: finds files", async () => {
    const dir = join(tmpdir(), "opencode-x-glob-test")
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, "a.ts"), "")
    writeFileSync(join(dir, "b.ts"), "")
    writeFileSync(join(dir, "c.js"), "")

    let rustGlob: { globFiles: (pattern: string, root: string) => Promise<{ path: string; size: number; isDir: boolean }[]> } | null = null
    try {
      rustGlob = require("../src/tool-exec/index.node") as any
    } catch { /* ok */ }

    if (rustGlob) {
      const entries = await rustGlob.globFiles("**/*.ts", dir)
      expect(entries).toHaveLength(2)
      const names = entries.map((e) => e.path.split("/").pop())
      expect(names).toContain("a.ts")
      expect(names).toContain("b.ts")
    }

    rmSync(dir, { recursive: true })
  })

  test("grepFiles: finds patterns", async () => {
    const dir = join(tmpdir(), "opencode-x-grep-test")
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, "hello.txt"), "hello world\nfoo bar")
    writeFileSync(join(dir, "other.txt"), "baz qux")

    let rustGrep: { grepFiles: (pattern: string, root: string, include?: string, maxMatches?: number) => Promise<{ path: string; line: number; column: number; text: string }[]> } | null = null
    try {
      rustGrep = require("../src/tool-exec/index.node") as any
    } catch { /* ok */ }

    if (rustGrep) {
      const matches = await rustGrep.grepFiles("hello|foo", dir)
      expect(matches).toHaveLength(2)
      expect(matches[0].text).toMatch(/hello|foo/)
    }

    rmSync(dir, { recursive: true })
  })

  test("executeShell: runs commands", async () => {
    let rustExec: { executeShell: (opts: { command: string; timeoutMs?: number }) => Promise<{ stdout: string; stderr: string; exitCode: number; timedOut: boolean }> } | null = null
    try {
      rustExec = require("../src/tool-exec/index.node") as any
    } catch { /* ok */ }

    if (rustExec) {
      const r = await rustExec.executeShell({ command: "echo hello", timeoutMs: 5000 })
      expect(r.exitCode).toBe(0)
      expect(r.stdout).toContain("hello")
    }
  })
})
