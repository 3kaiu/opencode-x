import { describe, expect, test } from "bun:test"
import { tmpdir } from "os"
import { join } from "path"
import { mkdirSync, writeFileSync, rmSync, statSync, readFileSync } from "fs"
import { Glob } from "bun"

import { Token } from "../src/util/token"

const CHARS_PER_TOKEN = 4

function estimate(text: string): number {
  return Math.max(0, Math.round(text.length / CHARS_PER_TOKEN))
}

describe("Token (heuristic)", () => {
  test("estimate: empty string", () => {
    expect(Token.estimate("")).toBe(0)
  })

  test("estimate: simple text", () => {
    expect(Token.estimate("Hello, world!")).toBe(3)
  })

  test("estimate: known sentence", () => {
    expect(Token.estimate("The quick brown fox jumps over the lazy dog")).toBe(11)
  })

  test("estimate: matches inline heuristic", () => {
    const texts = ["", "Hello", "The quick brown fox jumps over the lazy dog", JSON.stringify({ a: 1 })]
    for (const text of texts) {
      expect(Token.estimate(text)).toBe(estimate(text))
    }
  })
})

describe("bun:sqlite", () => {
  test("CRUD operations", () => {
    const { Database } = require("bun:sqlite") as { Database: new (path: string) => any }
    const dbPath = join(tmpdir(), "opencode-x-bun-sqlite-test.db")
    try { rmSync(dbPath) } catch { /* ok */ }

    const db = new Database(dbPath)
    db.run("PRAGMA journal_mode = WAL")

    db.run("CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT, value REAL)")
    db.run("INSERT INTO test (name, value) VALUES (?, ?)", "hello", 42.5)
    db.run("INSERT INTO test (name, value) VALUES (?, ?)", "world", 99.9)

    const rows = db.query("SELECT * FROM test ORDER BY id").all() as Record<string, unknown>[]
    expect(rows).toHaveLength(2)
    expect(rows[0].name).toBe("hello")
    expect(rows[0].value).toBe(42.5)

    db.run("UPDATE test SET value = ? WHERE id = ?", 100.0, 1)
    const afterUpdate = db.query("SELECT value FROM test WHERE id = 1").all() as Record<string, unknown>[]
    expect(afterUpdate[0].value).toBe(100.0)

    db.run("DELETE FROM test WHERE id = ?", 2)
    const afterDelete = db.query("SELECT COUNT(*) as cnt FROM test").all() as Record<string, unknown>[]
    expect(afterDelete[0].cnt).toBe(1)

    db.run("DROP TABLE test")
    db.close()
    try { rmSync(dbPath) } catch { /* ok */ }
  })
})

describe("Bun.Glob / Rust grep", () => {
  test("Bun.Glob: finds .ts files", () => {
    const dir = join(tmpdir(), "opencode-x-glob-test-2")
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, "a.ts"), "")
    writeFileSync(join(dir, "b.ts"), "")
    writeFileSync(join(dir, "c.js"), "")

    const entries: string[] = []
    const glob = new Glob("**/*.ts")
    for (const match of glob.scanSync({ cwd: dir })) {
      entries.push(match)
    }
    expect(entries).toHaveLength(2)
    expect(entries).toContain("a.ts")
    expect(entries).toContain("b.ts")

    rmSync(dir, { recursive: true })
  })

  test("grepFiles: finds patterns", async () => {
    const dir = join(tmpdir(), "opencode-x-grep-test")
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, "hello.txt"), "hello world\nfoo bar")

    let rustGrep: { grepFiles: (pattern: string, root: string) => Promise<{ path: string; line: number; column: number; text: string }[]> } | null = null
    try {
      rustGrep = require("../src/tool-exec/index.node") as any
    } catch { /* ok */ }

    if (rustGrep) {
      const matches = await rustGrep.grepFiles("hello|foo", dir)
      expect(matches).toHaveLength(2)
    }

    rmSync(dir, { recursive: true })
  })
})
