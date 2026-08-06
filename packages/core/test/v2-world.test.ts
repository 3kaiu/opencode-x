import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { sanitizeRemote } from "../src/world/snapshot"
import { Probe } from "../src/world/probe"
import path from "node:path"

describe("sanitizeRemote", () => {
  test("strips credentials from https URLs", () => {
    expect(sanitizeRemote("https://user:token@github.com/anomalyco/opencode.git")).toBe("github.com/anomalyco/opencode.git")
  })
  test("parses scp-like git@ URLs", () => {
    expect(sanitizeRemote("git@github.com:anomalyco/opencode.git")).toBe("github.com/anomalyco/opencode.git")
  })
  test("returns null for invalid input", () => {
    expect(sanitizeRemote(null)).toBeNull()
    expect(sanitizeRemote("not a url")).toBeNull()
  })
})

describe("Probe.head", () => {
  test("reads first N lines", async () => {
    const file = path.join(import.meta.dir, "fixtures", "probe-sample.txt")
    await Bun.write(file, "l1\nl2\nl3\nl4\nl5\n")
    const out = await Effect.runPromise(Probe.head(file, 2))
    expect(out).toBe("l1\nl2")
    await Bun.$`rm -f ${file}`
  })
})

describe("Probe.symbols", () => {
  test("extracts function/class symbols from TS source", async () => {
    const dir = path.join(import.meta.dir, "fixtures", "symproj")
    await Bun.write(path.join(dir, "sample.ts"), `export function foo() {}\nexport class Bar {}\nconst x = 1\n`)
    const out = await Effect.runPromise(Probe.symbols(dir, "*.ts", 20))
    const names = out.map((s) => s.name)
    expect(names).toContain("foo")
    expect(names).toContain("Bar")
    await Bun.$`rm -rf ${dir}`
  })
})
