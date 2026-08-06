import { describe, expect, test } from "bun:test"
import { SelectTools } from "../src/tool/select-tools"
import { ToolCache, createCache, hashArgs } from "../src/tool/cache"
import { Learn, detectCandidates, distillSkill, evidenceFromSession, evidenceFromTurns, signatureOf, type WorkflowEvidence } from "../src/skills/learn"
import { Loop } from "../src/introspection/loop"
import { Introspection, type DecisionRecord } from "../src/introspection/attribution"
import { Memory } from "../src/memory/store"

describe("SelectTools (M3 progressive disclosure)", () => {
  const tools = [
    { name: "read", definition: {}, dynamic: false },
    { name: "mcp__github", definition: {}, dynamic: true, frequency: 1 },
    { name: "mcp__files", definition: {}, dynamic: true, frequency: 0 },
  ]

  test("classify keeps static tools and separates dynamic", () => {
    const { staticTools, dynamicTools } = SelectTools.classify(tools)
    expect(staticTools.map((t) => t.name)).toEqual(["read"])
    expect(dynamicTools.map((t) => t.name)).toEqual(["mcp__github", "mcp__files"])
  })

  test("requested dynamic tool is announced via marker, not added to top-level", () => {
    const state = SelectTools.initialState()
    const { state: next, marker } = SelectTools.decideNext(state, tools.filter((t) => t.dynamic), ["mcp__github"])
    expect(marker).toContain("<tools_added>mcp__github</tools_added>")
    expect(SelectTools.topLevelTools(tools, next).map((t) => t.name)).toEqual(["read"])
  })

  test("high-frequency dynamic tools promote to permanent top-level", () => {
    const hot = [{ name: "mcp__hot", definition: {}, dynamic: true, frequency: 5 }]
    const state = SelectTools.initialState()
    const { state: next } = SelectTools.decideNext(state, hot, [])
    expect(SelectTools.topLevelTools(hot, next)).toHaveLength(1)
    expect(next.promoted.has("mcp__hot")).toBe(true)
  })
})

describe("ToolCache (M3 result cache)", () => {
  test("cached() returns value and stores on miss", () => {
    let state = createCache()
    let computes = 0
    const key = { tool: "grep", argsHash: hashArgs({ pattern: "foo" }), mtimes: [] }
    const first = ToolCache.cached(state, key, () => {
      computes++
      return "result"
    })
    expect(first.hit).toBe(false)
    expect(first.value).toBe("result")
    const second = ToolCache.cached(first.state, key, () => {
      computes++
      return "result"
    })
    expect(second.hit).toBe(true)
    expect(computes).toBe(1)
  })

  test("stale when file mtime moves forward", () => {
    let state = createCache()
    const key = { tool: "grep", argsHash: "h", mtimes: [{ path: "/a", mtimeMs: 100 }] }
    state = ToolCache.store(state, key, "v1")
    // same key with newer mtime → miss
    const newer = { tool: "grep", argsHash: "h", mtimes: [{ path: "/a", mtimeMs: 200 }] }
    expect(ToolCache.lookup(state, newer)).toBeUndefined()
  })

  test("invalidatePaths drops matching entries", () => {
    let state = createCache()
    state = ToolCache.store(state, { tool: "grep", argsHash: "h", mtimes: [{ path: "/repo/a.ts", mtimeMs: 1 }] }, "v")
    state = ToolCache.invalidatePaths(state, ["/repo/a.ts"])
    expect(state.entries.size).toBe(0)
  })

  test("LRU eviction caps the cache", () => {
    let state = createCache(2)
    for (let i = 0; i < 5; i++) {
      state = ToolCache.store(state, { tool: "grep", argsHash: `h${i}`, mtimes: [] }, `v${i}`)
    }
    expect(state.entries.size).toBeLessThanOrEqual(2)
  })
})

describe("Learn (M10 automatic skill learning)", () => {
  const ev = (title: string, tool: string): WorkflowEvidenceShape => ({ title, tool })

  const workflow = (
    steps: ReadonlyArray<{ title: string; tool: string }>,
    executions: number,
    successRate: number,
  ): WorkflowEvidence => ({
    planSteps: steps.map((s) => ({ ...s, goal: s.title })),
    successRate,
    executions,
    sessionIDs: [],
  })

  test("signature groups identical sequences", () => {
    const a = signatureOf([{ title: "reproduce", tool: "bash" }, { title: "fix", tool: "edit" }])
    const b = signatureOf([{ title: "reproduce", tool: "bash" }, { title: "fix", tool: "edit" }])
    expect(a).toBe(b)
  })

  test("distillSkill requires repeated high-success execution", () => {
    expect(distillSkill(workflow([{ title: "x", tool: "bash" }], 1, 1))).toBeNull() // too few
    expect(distillSkill(workflow([{ title: "x", tool: "bash" }], 3, 0.5))).toBeNull() // low success
    const skill = distillSkill(workflow([{ title: "run tests", tool: "bash" }], 3, 0.9))
    expect(skill).not.toBeNull()
    expect(skill!.status).toBe("pending")
    expect(skill!.source).toBe("learned")
  })

  test("detectCandidates aggregates across sessions", () => {
    const shared = [{ title: "reproduce", tool: "bash" }, { title: "fix", tool: "edit" }, { title: "verify", tool: "bash" }]
    const candidates = detectCandidates([
      workflow(shared, 2, 1),
      workflow(shared, 3, 0.9),
    ])
    expect(candidates.length).toBe(1)
    expect(candidates[0].id).toContain("learned-")
    expect(candidates[0].steps).toHaveLength(3)
  })

  test("evidenceFromSession derives workflow from introspection records", () => {
    const records = [
      rec(1, "bash", "run tests", "success"),
      rec(2, "read", "inspect output", "success"),
      rec(3, "bash", "run tests", "failure"),
    ]
    const ev = evidenceFromSession(records)
    expect(ev).not.toBeNull()
    expect(ev!.successRate).toBeCloseTo(2 / 3)
    expect(ev!.planSteps).toHaveLength(3)
  })

  test("confirmation flow promotes candidates to usable", () => {
    const single = distillSkill(workflow([{ title: "a", tool: "bash" }], 3, 1))
    const candidates = single ? [single] : []
    expect(candidates).toHaveLength(1)
    const confirmed = Learn.confirmCandidate(candidates, candidates[0].id)
    expect(Learn.usable(confirmed)).toHaveLength(1)
    const rejected = Learn.rejectCandidate(candidates, candidates[0].id)
    expect(Learn.usable(rejected)).toHaveLength(0)
  })

  test("evidenceFromTurns derives workflow from orchestrator turns", () => {
    const ev = evidenceFromTurns(
      [
        { toolCalls: [{ name: "read" }, { name: "search" }], stopReason: "tool_use" },
        { toolCalls: [{ name: "write" }], stopReason: "tool_use" },
        { toolCalls: [], stopReason: "end" },
        { toolCalls: [{ name: "run" }], stopReason: "error" },
      ],
      "s1",
    )
    expect(ev.planSteps.map((s) => s.tool)).toEqual(["read", "search", "write", "run"])
    expect(ev.successRate).toBeCloseTo(3 / 4)
    expect(ev.executions).toBe(1)
    expect(ev.sessionIDs).toEqual(["s1"])
  })

  test("renderSkillSteps renders steps for prompt injection", () => {
    const skill = distillSkill(workflow([{ title: "read", tool: "read" }, { title: "write", tool: "write" }, { title: "verify", tool: "run" }], 2, 1))
    const text = Learn.renderSkillSteps(skill!)
    expect(text).toContain("Learned workflow")
    expect(text).toContain("read (via read)")
    expect(text).toContain("verify (via run)")
  })
})

describe("Loop (metacognition M12→M5→M10)", () => {
  test("failure records sediment lessons into memory", async () => {
    const dir = `/tmp/v2loop-${Date.now()}`
    const store = await Memory.openMemory(dir)
    const records: ReadonlyArray<DecisionRecord> = [
      rec(1, "read", "read file", "failure", "No such file"),
    ]
    const result = await Loop.runMetacognition({ memory: store }, records)
    expect(result.lessonID).not.toBeNull()
    const entries = await Memory.replayWire(store)
    const lesson = entries.get(result.lessonID!)
    expect(lesson).toBeDefined()
    expect(lesson!.category).toBe("lesson")
    expect(lesson!.status).toBe("pending")
    expect(lesson!.content).toContain("probe")
    await Bun.$`rm -rf ${dir}`
  })

  test("successful sessions yield candidate skills", async () => {
    const dir = `/tmp/v2loop2-${Date.now()}`
    const store = await Memory.openMemory(dir)
    const records: ReadonlyArray<DecisionRecord> = [
      rec(1, "bash", "reproduce", "success"),
      rec(2, "edit", "fix", "success"),
      rec(3, "bash", "verify", "success"),
    ]
    const result = await Loop.runMetacognition({ memory: store }, records, 2)
    expect(result.candidates.length).toBe(1)
    await Bun.$`rm -rf ${dir}`
  })
})

type WorkflowEvidenceShape = { title: string; tool: string }

const rec = (
  seq: number,
  tool: string,
  decision: string,
  outcome: "success" | "failure",
  error?: string,
): DecisionRecord => ({
  turn: seq,
  contextFingerprint: `fp-${seq}`,
  action: { tool, args: {}, decision },
  result: outcome === "failure" ? { outcome, errorFingerprint: error } : { outcome },
  seq,
})

export { Introspection }
