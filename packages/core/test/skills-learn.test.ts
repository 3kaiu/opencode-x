import { describe, expect, test } from "bun:test"
import { Learn, type WorkflowEvidence } from "../src/skills/learn"
import { Introspection, type DecisionRecord } from "../src/introspection/attribution"

const evidence = (over: Partial<WorkflowEvidence> = {}): WorkflowEvidence => ({
  planSteps: [{ title: "read config", tool: "read", goal: "inspect config" }],
  successRate: 1,
  executions: 2,
  sessionIDs: ["s1"],
  ...over,
})

const record = (over: Partial<DecisionRecord> = {}): DecisionRecord => ({
  turn: 1,
  contextFingerprint: "ctx",
  action: { tool: "read", args: {}, decision: "read file" },
  result: { outcome: "success" },
  seq: 1,
  ...over,
})

describe("Learn.signatureOf", () => {
  test("identical ordered steps share a signature", () => {
    const a = [{ title: "a", tool: "read" }]
    const b = [{ title: "a", tool: "read" }]
    expect(Learn.signatureOf(a)).toBe(Learn.signatureOf(b))
  })

  test("reordered steps differ", () => {
    const a = [{ title: "a", tool: "read" }, { title: "b", tool: "edit" }]
    const b = [{ title: "b", tool: "edit" }, { title: "a", tool: "read" }]
    expect(Learn.signatureOf(a)).not.toBe(Learn.signatureOf(b))
  })
})

describe("Learn.distillSkill", () => {
  test("requires minimum executions", () => {
    expect(Learn.distillSkill(evidence({ executions: 1 }))).toBeNull()
  })

  test("requires high success rate", () => {
    expect(Learn.distillSkill(evidence({ successRate: 0.5 }))).toBeNull()
  })

  test("produces a pending candidate with steps", () => {
    const skill = Learn.distillSkill(evidence())
    expect(skill).not.toBeNull()
    expect(skill!.status).toBe("pending")
    expect(skill!.source).toBe("learned")
    expect(skill!.steps[0].title).toBe("read config")
    expect(skill!.id).toBe(`learned-${skill!.name}`)
  })

  test("kebab-names from the first goal", () => {
    const skill = Learn.distillSkill(evidence({ planSteps: [{ title: "t", tool: "read", goal: "Fix the Bug Now!" }] }))
    expect(skill!.name).toBe("fix-the-bug-now")
  })
})

describe("Learn.groupBySignature", () => {
  test("groups identical workflows and merges counts", () => {
    const groups = Learn.groupBySignature([
      evidence({ sessionIDs: ["s1"], executions: 2 }),
      evidence({ sessionIDs: ["s2"], executions: 3 }),
    ])
    expect(groups.size).toBe(1)
    const group = [...groups.values()][0]!
    expect(group.count).toBe(2)
    expect(group.evidence.executions).toBe(5)
    expect(group.evidence.sessionIDs).toEqual(["s1", "s2"])
  })
})

describe("Learn.detectCandidates", () => {
  test("requires repeated signatures across sessions", () => {
    const candidates = Learn.detectCandidates([
      evidence({ sessionIDs: ["s1"] }),
      evidence({ sessionIDs: ["s2"] }),
    ])
    expect(candidates.length).toBe(1)
  })

  test("single workflow stays below the threshold", () => {
    expect(Learn.detectCandidates([evidence()])).toEqual([])
  })
})

describe("Learn.evidenceFromSession", () => {
  test("derives steps and success rate from records", () => {
    const ev = Learn.evidenceFromSession([
      record({ action: { tool: "read", args: {}, decision: "read config" } }),
      record({ result: { outcome: "failure", errorFingerprint: "x" }, action: { tool: "edit", args: {}, decision: "edit config" } }),
    ])
    expect(ev?.planSteps).toHaveLength(2)
    expect(ev?.successRate).toBe(0.5)
    expect(ev?.executions).toBe(2)
  })

  test("empty records yield no evidence", () => {
    expect(Learn.evidenceFromSession([])).toBeNull()
  })
})

describe("Learn.createLearningStore", () => {
  test("confirm and reject update status immutably", () => {
    const store = Learn.createLearningStore([Learn.distillSkill(evidence())!])
    const confirmed = store.confirm(store.candidates[0].id)
    expect(confirmed.candidates[0].status).toBe("confirmed")
    expect(store.candidates[0].status).toBe("pending")
    expect(Learn.usable(confirmed.candidates)).toHaveLength(1)
    const rejected = store.reject(store.candidates[0].id)
    expect(Learn.usable(rejected.candidates)).toHaveLength(0)
  })
})

describe("Learn.renderSkillSteps", () => {
  test("renders an instruction block", () => {
    const skill = Learn.distillSkill(evidence({ executions: 3, successRate: 1 }))!
    const block = Learn.renderSkillSteps(skill)
    expect(block).toContain("3 executions")
    expect(block).toContain("read config (via read)")
  })
})

describe("Learn evidence integration with Introspection", () => {
  test("evidenceFromSession + distillSkill closes the loop", () => {
    const records = Array.from({ length: 2 }, () =>
      record({ action: { tool: "read", args: {}, decision: "read package.json" } }),
    )
    const ev = Learn.evidenceFromSession(records)!
    expect(Learn.distillSkill(ev)?.status).toBe("pending")
    expect(Introspection.summarize(records).failures).toBe(0)
  })
})
