import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { FsTools } from "../src/v2/tools/fs-tools"
import { RunTools } from "../src/v2/tools/run-tools"
import { Verify } from "../src/v2/verify/verifier"
import { Trigger } from "../src/v2/verify/trigger"
import path from "node:path"

describe("FsTools (real filesystem, hardened)", () => {
  test("read of missing file returns error text, never throws", async () => {
    const out = await Effect.runPromise(FsTools.read("/tmp", "does-not-exist-xyz.ts"))
    expect(out).toContain("error: cannot read")
  })

  test("read of a directory returns error text, never throws", async () => {
    const out = await Effect.runPromise(FsTools.read("/tmp", "v2cli-demo"))
    expect(out).toContain("error: cannot read")
  })

  test("path escape is rejected", async () => {
    const out = await Effect.runPromise(FsTools.read("/tmp/v2cli-demo", "../../etc/passwd"))
    expect(out).toContain("escapes")
  })

  test("write enforces allowed prefixes", async () => {
    const out = await Effect.runPromise(FsTools.write("/tmp/v2cli-demo", "test/evil.test.ts", "x", ["src"]))
    expect(out).toContain("not allowed")
  })

  test("atomic write round-trips content", async () => {
    const dir = `/tmp/v2fs-${Date.now()}`
    await Bun.$`mkdir -p ${dir}`
    const out = await Effect.runPromise(FsTools.write(dir, "a/b.ts", "hello"))
    expect(out).toContain("wrote 5 bytes")
    expect(await Bun.file(path.join(dir, "a", "b.ts")).text()).toBe("hello")
    await Bun.$`rm -rf ${dir}`
  })

  test("run captures exit code and output, never throws", async () => {
    const dir = `/tmp/v2fs-run-${Date.now()}`
    await Bun.$`mkdir -p ${dir}`
    const ok = await Effect.runPromise(RunTools.run(dir, "echo hi"))
    expect(ok).toContain("exit 0")
    expect(ok).toContain("hi")
    const bad = await Effect.runPromise(RunTools.run(dir, "exit 3"))
    expect(bad).toContain("exit 3")
    await Bun.$`rm -rf ${dir}`
  })

  test("parseBunTestOutput extracts failing test names", () => {
    const failures = Verify.parseBunTestOutput(`bun test v1.3.14
(fail) subtract(10, 4) === 6 [0.13ms]
 0 pass
 1 fail
`)
    expect(failures).toHaveLength(1)
    expect(failures[0].category).toBe("assert")
    expect(failures[0].message).toContain("subtract")
  })
})

describe("Trigger (M9, real verifiers)", () => {
  test("matchingVerifiers + runVerifiers execute real bun test and parse failures", async () => {
    const dir = `/tmp/v2trigger-${Date.now()}`
    await Bun.$`mkdir -p ${dir}/src ${dir}/test`
    await Bun.write(path.join(dir, "src", "calc.ts"), "export const subtract = (a: number, b: number) => a + b\n")
    await Bun.write(
      path.join(dir, "test", "calc.test.ts"),
      `import { test, expect } from "bun:test"
import { subtract } from "../src/calc"
test("sub", () => expect(subtract(10, 4)).toBe(6))
`,
    )
    const verifiers = Trigger.matchingVerifiers(Verify.DEFAULT_VERIFIERS, ["src/calc.ts", "test/calc.test.ts"])
    const reports = await Effect.runPromise(Trigger.runVerifiers(dir, verifiers))
    expect(reports.map((r) => r.verifier).sort()).toEqual(["lint", "test", "typecheck"])
    const testReport = reports.find((r) => r.verifier === "test")!
    expect(testReport.passed).toBe(false)
    expect(testReport.failures[0].message).toContain("sub")
    const rendered = Trigger.renderReports(reports)
    expect(rendered.some((l) => l.startsWith("test: FAILED"))).toBe(true)
    await Bun.$`rm -rf ${dir}`
  })
})
