import { describe, expect, it } from "bun:test"
import { isVerifyReport, parseVerifyReport } from "../../../src/routes/session/verify"

describe("parseVerifyReport", () => {
  it("parses a passed-only report", () => {
    const items = parseVerifyReport("[auto-verify] typecheck: passed")
    expect(items).toEqual([{ verifier: "typecheck", status: "passed" }])
  })

  it("parses a mixed report with failures", () => {
    const items = parseVerifyReport(
      "[auto-verify] typecheck: passed; lint: FAILED — src/App.ts: Cannot find name 'x' (2 failures); test: skipped (not runnable here, exit 1)",
    )
    expect(items).toEqual([
      { verifier: "typecheck", status: "passed" },
      {
        verifier: "lint",
        status: "failed",
        detail: "src/App.ts: Cannot find name 'x'",
        failures: 2,
      },
      { verifier: "test", status: "skipped", detail: "not runnable here, exit 1" },
    ])
  })

  it("parses a failed report without a failure count", () => {
    const items = parseVerifyReport("[auto-verify] test: FAILED — src/a.test.ts: Expected 1 to be 2")
    expect(items).toEqual([
      { verifier: "test", status: "failed", detail: "src/a.test.ts: Expected 1 to be 2", failures: undefined },
    ])
  })

  it("returns [] for non-verify text", () => {
    expect(parseVerifyReport("hello")).toEqual([])
    expect(parseVerifyReport("")).toEqual([])
  })
})

describe("isVerifyReport", () => {
  it("matches the auto-verify prefix", () => {
    expect(isVerifyReport("[auto-verify] typecheck: passed")).toBe(true)
    expect(isVerifyReport("  [auto-verify] lint: failed")).toBe(true)
    expect(isVerifyReport("typecheck: passed")).toBe(false)
  })
})