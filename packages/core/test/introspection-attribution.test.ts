import { describe, expect, test } from "bun:test"
import { Introspection, type DecisionRecord, type IntrospectionStore } from "../src/introspection/attribution"

const record = (over: Partial<DecisionRecord> = {}): DecisionRecord => ({
  turn: 1,
  contextFingerprint: "ctx",
  action: { tool: "read", args: {}, decision: "read file" },
  result: { outcome: "success" },
  seq: 1,
  ...over,
})

describe("Introspection.shouldRecord", () => {
  test("always records failures", () => {
    expect(Introspection.shouldRecord(record({ result: { outcome: "failure", errorFingerprint: "enoent" } }))).toBe(
      true,
    )
  })

  test("samples successes at the rate", () => {
    const always = Introspection.shouldRecord(record(), 0.1, () => 0.01)
    const never = Introspection.shouldRecord(record(), 0.1, () => 0.99)
    expect(always).toBe(true)
    expect(never).toBe(false)
  })
})

describe("Introspection.appendRecord", () => {
  test("appends in order", () => {
    const store: IntrospectionStore = { records: [] }
    const a = record({ seq: 1 })
    const b = record({ seq: 2 })
    expect(Introspection.appendRecord(Introspection.appendRecord(store, a), b).records).toEqual([a, b])
  })
})

describe("Introspection.attribute", () => {
  test("missing-context on not-found errors", () => {
    const r = record({ result: { outcome: "failure", errorFingerprint: "No such file or directory" } })
    expect(Introspection.attribute(r, []).rootCause).toBe("missing-context")
  })

  test("tool-misuse on permission errors", () => {
    const r = record({ result: { outcome: "failure", errorFingerprint: "permission denied" } })
    expect(Introspection.attribute(r, []).rootCause).toBe("tool-misuse")
  })

  test("stale-assumption when chain mentions staleness", () => {
    const r = record({ result: { outcome: "failure", errorFingerprint: "conflict" } })
    const chain = [{ seq: 0, hypothesis: "stale file list" }]
    expect(Introspection.attribute(r, chain).rootCause).toBe("stale-assumption")
  })

  test("defaults to model-limit", () => {
    const r = record({ result: { outcome: "failure", errorFingerprint: "exceeded max tokens" } })
    expect(Introspection.attribute(r, []).rootCause).toBe("model-limit")
  })
})

describe("Introspection.lessonFor", () => {
  test("renders a lesson per root cause", () => {
    const a = Introspection.attribute(record({ result: { outcome: "failure", errorFingerprint: "not found" } }), [])
    expect(Introspection.lessonFor(a, "read")).toContain("probe")
    const b = Introspection.attribute(record({ result: { outcome: "failure", errorFingerprint: "denied" } }), [])
    expect(Introspection.lessonFor(b, "read")).toContain("contract")
  })
})

describe("Introspection.summarize", () => {
  test("aggregates failures by tool", () => {
    const records = [
      record({ turn: 1, action: { tool: "read", args: {}, decision: "r" }, result: { outcome: "failure", errorFingerprint: "x" } }),
      record({ turn: 2, action: { tool: "read", args: {}, decision: "r" }, result: { outcome: "failure", errorFingerprint: "y" } }),
      record({ turn: 3, action: { tool: "edit", args: {}, decision: "e" }, result: { outcome: "success" } }),
    ]
    const summary = Introspection.summarize(records)
    expect(summary.total).toBe(3)
    expect(summary.failures).toBe(2)
    expect(summary.successRate).toBeCloseTo(1 / 3)
    expect(summary.topFailures[0]).toEqual({ tool: "read", count: 2 })
  })

  test("empty records have full success rate", () => {
    const summary = Introspection.summarize([])
    expect(summary.total).toBe(0)
    expect(summary.successRate).toBe(1)
    expect(summary.topFailures).toEqual([])
  })
})
