import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { Planning } from "../src/v2/planning/plan"
import { Verify } from "../src/v2/verify/verifier"
import { Parallel } from "../src/v2/execution/parallel"
import { Memory, MemorySearch } from "../src/v2/memory/index"
import { Governance } from "../src/v2/governance/ledger"
import { Skills } from "../src/v2/skills/skill"
import { Introspection } from "../src/v2/introspection/attribution"
import { tokenize } from "../src/v2/memory/search"

describe("Planning", () => {
  test("dependency readiness", () => {
    const plan = Planning.createPlan([
      { id: "a", parentID: null, title: "t", goal: "g", acceptanceCriteria: [], status: "done", dependsOn: [], spent: { tokens: 0, durationMs: 0 }, checkpoint: false },
      { id: "b", parentID: "a", title: "t", goal: "g", acceptanceCriteria: [], status: "pending", dependsOn: ["a"], spent: { tokens: 0, durationMs: 0 }, checkpoint: false },
      { id: "c", parentID: "a", title: "t", goal: "g", acceptanceCriteria: [], status: "pending", dependsOn: ["missing"], spent: { tokens: 0, durationMs: 0 }, checkpoint: false },
    ])
    expect(Planning.isReady(plan.nodes.get("b")!, plan)).toBe(true)
    expect(Planning.isReady(plan.nodes.get("c")!, plan)).toBe(false)
    expect(Planning.progressOf(plan)).toEqual({ done: 1, total: 3, blocked: [] })
  })
  test("drift detection flags out-of-plan writes", () => {
    const plan = Planning.createPlan([])
    const drift = Planning.detectDrift("src/extra.ts", plan, ["src/main.ts"])
    expect(drift).not.toBeNull()
    expect(drift!.kind).toBe("moderate")
    const minor = Planning.detectDrift("dist/output.txt", plan)
    expect(minor?.kind).toBe("minor")
    expect(minor?.suggested).toBe("ignore")
  })
})

describe("Verify", () => {
  test("parses tsgo output into structured failures", () => {
    const failures = Verify.parseTsgoOutput(
      "src/a.ts(10,5): error TS2322: Type 'string' is not assignable to type 'number'.\nsrc/b.ts(3,1): error TS2551: Property 'x' does not exist.",
    )
    expect(failures).toHaveLength(2)
    expect(failures[0]).toMatchObject({ file: "src/a.ts", line: 10, category: "type" })
  })
  test("classifies known vs novel failures against baseline", () => {
    const baseline: Verify.RegressionBaseline = { knownFailures: new Set(["test:known fail"]) }
    const result: Verify.VerificationResult = {
      verifier: "test",
      passed: false,
      failures: [
        { file: "", message: "known fail", category: "assert" },
        { file: "", message: "new fail", category: "assert" },
      ],
      durationMs: 10,
    }
    const { known, novel } = Verify.classifyFailures(result, baseline)
    expect(known).toHaveLength(1)
    expect(novel).toHaveLength(1)
  })
  test("orders fast verifiers first", () => {
    const order = Verify.orderedVerifiers([Verify.DEFAULT_VERIFIERS[2], Verify.DEFAULT_VERIFIERS[0]])
    expect(order[0].cost).toBe("fast")
  })
})

describe("Parallel", () => {
  test("returns results in source order", async () => {
    const result = await Effect.runPromise(
      Parallel.runGroup([
        { id: "1", run: Effect.delay(Effect.succeed("a"), "5 millis") },
        { id: "2", run: Effect.delay(Effect.succeed("b"), "1 millis") },
      ]),
    )
    expect(result.results).toEqual(["a", "b"])
  })
  test("detects write conflicts", () => {
    const conflicts = Parallel.detectWriteConflict([
      { id: "1", run: Effect.void, writes: ["/repo/src/a.ts"] },
      { id: "2", run: Effect.void, writes: ["/repo/src/a.ts"] },
    ])
    expect(conflicts).toHaveLength(1)
    expect(Parallel.detectWriteConflict([
      { id: "1", run: Effect.void, writes: ["/repo/a"] },
      { id: "2", run: Effect.void, writes: ["/repo/b"] },
    ])).toHaveLength(0)
  })
})

describe("Memory", () => {
  test("wire replay tolerates trailing partial line", async () => {
    const dir = `/tmp/v2mem-test-${Date.now()}`
    const store = await Memory.openMemory(dir)
    const entry: Memory.MemoryEntry = { id: "m1", category: "project", title: "t", content: "c", keywords: [], created_at: 1, updated_at: 1, status: "confirmed" }
    await Memory.appendWire(store, { type: "memory.upsert", entry })
    await Bun.write(store.wirePath, await Bun.file(store.wirePath).text() + '{"type":"memory.upsert","entry":{"id":"broken"') 
    const entries = await Memory.replayWire(store)
    expect(entries.get("m1")?.content).toBe("c")
    expect(entries.size).toBe(1)
    await Bun.$`rm -rf ${dir}`
  })
  test("tokenize handles CJK bigrams", () => {
    const tokens = tokenize("测试代码 code review")
    expect(tokens).toContain("测试")
    expect(tokens).toContain("code")
    expect(tokens).toContain("review")
  })
  test("search scores by keyword and decays old entries", () => {
    const now = Date.now()
    const entries = [
      { id: "1", category: "project" as const, title: "bun build", content: "bun run typecheck", keywords: ["bun"], created_at: now, updated_at: now, status: "confirmed" as const },
      { id: "2", category: "project" as const, title: "old", content: "typecheck old way", keywords: [], created_at: now - 60 * 86_400_000, updated_at: now - 60 * 86_400_000, status: "pending" as const },
    ]
    const hits = MemorySearch.search(entries, "typecheck bun", 5, now)
    expect(hits.length).toBeGreaterThan(0)
    expect(hits[0].entry.id).toBe("1")
  })
})

describe("Governance", () => {
  test("budget gate transitions ok → alert → hardstop", () => {
    const budget = { limit: 2.0, alertAt: 0.5, hardStopAt: 0.9 }
    expect(Governance.evaluateGate(0.5, budget)).toBe("ok")
    expect(Governance.evaluateGate(1.2, budget)).toBe("alert")
    expect(Governance.evaluateGate(1.9, budget)).toBe("hardstop")
  })
  test("ledger accumulates per task and session", () => {
    const ledger = Governance.recordUsage(Governance.emptyLedger(), "t1", "m1", { input: 10, output: 5, reasoning: 0, cacheRead: 0, cacheWrite: 0, cost: 0.1 })
    const ledger2 = Governance.recordUsage(ledger, "t1", "m1", { input: 10, output: 5, reasoning: 0, cacheRead: 0, cacheWrite: 0, cost: 0.1 })
    expect(ledger2.sessionTotal.input).toBe(20)
    expect(ledger2.byTask.get("t1")?.cost).toBeCloseTo(0.2)
  })
})

describe("Skills", () => {
  test("location priority resolves collisions", () => {
    const builtin: Skills.Skill = { id: "1", name: "test", description: "d", preconditions: [], steps: [], verifiers: [], source: "builtin", version: 1 }
    const project: Skills.Skill = { ...builtin, id: "2", source: "project" }
    const resolved = Skills.resolveSkills([builtin, project])
    expect(resolved[0].source).toBe("project")
  })
  test("matching ranks by description overlap", () => {
    const skill: Skills.Skill = { id: "1", name: "run-tests", description: "run the test suite with bun", whenToUse: "after editing tests", preconditions: [], steps: [], verifiers: [], source: "builtin", version: 1 }
    const matches = Skills.matchSkill([skill], "run tests", 3)
    expect(matches[0].name).toBe("run-tests")
  })
  test("toPlanSeed chains steps linearly", () => {
    const skill: Skills.Skill = { id: "1", name: "fix", description: "d", preconditions: [], steps: [{ kind: "step", title: "reproduce", ref: "bash" }, { kind: "step", title: "fix", ref: "edit" }], verifiers: [], source: "builtin", version: 1 }
    const seed = Skills.toPlanSeed(skill)
    expect(seed).toHaveLength(2)
    expect(seed[1].dependsOn).toEqual([seed[0].id])
  })
})

describe("Introspection", () => {
  test("failures always recorded, successes sampled", () => {
    const fail: Introspection.DecisionRecord = { turn: 1, contextFingerprint: "f", action: { tool: "bash", args: {}, decision: "d" }, result: { outcome: "failure", errorFingerprint: "not found" }, seq: 1 }
    expect(Introspection.shouldRecord(fail, 0.1, () => 0)).toBe(true)
    const ok: Introspection.DecisionRecord = { ...fail, result: { outcome: "success" }, seq: 2 }
    expect(Introspection.shouldRecord(ok, 0.1, () => 0.5)).toBe(false)
    expect(Introspection.shouldRecord(ok, 0.1, () => 0.05)).toBe(true)
  })
  test("attributes missing-context failures", () => {
    const rec: Introspection.DecisionRecord = { turn: 1, contextFingerprint: "f", action: { tool: "read", args: {}, decision: "d" }, result: { outcome: "failure", errorFingerprint: "No such file" }, seq: 1 }
    const attribution = Introspection.attribute(rec, [])
    expect(attribution.rootCause).toBe("missing-context")
    expect(Introspection.lessonFor(attribution, "read")).toContain("probe")
  })
  test("summarize computes success rate and top failures", () => {
    const rec = (seq: number, tool: string, outcome: "success" | "failure"): Introspection.DecisionRecord => ({ turn: seq, contextFingerprint: "f", action: { tool, args: {}, decision: "d" }, result: { outcome }, seq })
    const summary = Introspection.summarize([rec(1, "bash", "failure"), rec(2, "bash", "failure"), rec(3, "read", "success")])
    expect(summary.successRate).toBeCloseTo(1 / 3)
    expect(summary.topFailures[0]).toEqual({ tool: "bash", count: 2 })
  })
})
