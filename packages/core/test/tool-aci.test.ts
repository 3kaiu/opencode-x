import { describe, expect, test } from "bun:test"
import { Aci } from "../src/tool/aci"

describe("Aci", () => {
  test("classify returns category and retry hint", () => {
    const audit = Aci.auditMessage("enoent: no such file", { idempotent: true, canProbe: true })
    expect(audit.category).toBe("NotFound")
    expect(audit.hint).toEqual({ kind: "probe-first" })
    const timeout = Aci.auditMessage("operation timed out", { idempotent: false, canProbe: false })
    expect(timeout.category).toBe("Timeout")
    expect(timeout.hint).toEqual({ kind: "retry-with-changes" })
  })
})
