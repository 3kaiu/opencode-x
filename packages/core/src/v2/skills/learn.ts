// V2 skills — automatic learning pipeline (M10 §10.6, kimi + self).
// Detects recurring successful workflows from M8 plan executions + M12 retro
// data and distills them into candidate skills (pending confirmation).
export * as Learn from "./learn"

import type { Skill } from "./skill"
import type { Introspection } from "../introspection/attribution"

export interface WorkflowEvidence {
  readonly planSteps: ReadonlyArray<{ readonly title: string; readonly tool: string; readonly goal: string }>
  readonly successRate: number
  readonly executions: number
  readonly sessionIDs: ReadonlyArray<string>
}

export interface SkillCandidate extends Skill {
  readonly evidence: WorkflowEvidence
  readonly status: "pending" | "confirmed" | "rejected"
}

/**
 * Groups workflow evidence by a signature derived from the step titles.
 * Identical sequences (same ordered tool+title pairs) across sessions are the
 * same workflow.
 */
export function signatureOf(steps: ReadonlyArray<{ readonly title: string; readonly tool: string }>): string {
  return steps.map((s) => `${s.tool}:${s.title}`).join(" → ")
}

export function groupBySignature(
  evidences: ReadonlyArray<WorkflowEvidence>,
): ReadonlyMap<string, { readonly evidence: WorkflowEvidence; readonly count: number }> {
  const groups = new Map<string, { evidence: WorkflowEvidence; count: number }>()
  for (const ev of evidences) {
    const sig = signatureOf(ev.planSteps)
    const existing = groups.get(sig)
    if (existing) {
      existing.count += 1
      existing.evidence = {
        ...existing.evidence,
        executions: existing.evidence.executions + ev.executions,
        successRate: Math.max(existing.evidence.successRate, ev.successRate),
        sessionIDs: [...existing.evidence.sessionIDs, ...ev.sessionIDs],
      }
    } else {
      groups.set(sig, { evidence: ev, count: 1 })
    }
  }
  return groups
}

/** Distills a skill from repeated evidence (≥2 executions, high success). */
export function distillSkill(
  evidence: WorkflowEvidence,
  minExecutions = 2,
  minSuccessRate = 0.8,
): SkillCandidate | null {
  if (evidence.executions < minExecutions) return null
  if (evidence.successRate < minSuccessRate) return null
  const name = kebabName(evidence.planSteps[0]?.goal ?? "workflow")
  return {
    id: `learned-${name}`,
    name,
    description: `Learned workflow: ${evidence.planSteps.map((s) => s.title).join(" → ")}`,
    preconditions: [],
    steps: evidence.planSteps.map((s, i) => ({
      kind: "step" as const,
      title: s.title,
      ref: s.tool,
      params: { goal: s.goal },
    })),
    verifiers: [],
    source: "learned",
    version: 1,
    evidence,
    status: "pending",
  }
}

function kebabName(goal: string): string {
  const slug = goal.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
  return slug.slice(0, 40) || "workflow"
}

/** Detects candidate skills across a set of workflow evidences. */
export function detectCandidates(
  evidences: ReadonlyArray<WorkflowEvidence>,
  minExecutions = 2,
  minSuccessRate = 0.8,
): ReadonlyArray<SkillCandidate> {
  const groups = groupBySignature(evidences)
  const candidates: SkillCandidate[] = []
  for (const { evidence, count } of groups.values()) {
    if (count < minExecutions) continue
    const skill = distillSkill(
      { ...evidence, executions: evidence.executions * count },
      minExecutions,
      minSuccessRate,
    )
    if (skill) candidates.push(skill)
  }
  return candidates
}

/** Derives workflow evidence from introspection records of a session. */
export function evidenceFromSession(
  records: ReadonlyArray<Introspection.DecisionRecord>,
): WorkflowEvidence | null {
  const steps = records.map((r) => ({
    title: r.action.decision || r.action.tool,
    tool: r.action.tool,
    goal: r.action.decision,
  }))
  if (steps.length === 0) return null
  const failures = records.filter((r) => r.result.outcome === "failure").length
  return {
    planSteps: steps,
    successRate: 1 - failures / records.length,
    executions: records.length,
    sessionIDs: [],
  }
}

/** Derives workflow evidence straight from orchestrator turns (M10 real loop). */
export function evidenceFromTurns(
  turns: ReadonlyArray<{ readonly toolCalls: ReadonlyArray<{ readonly name: string }>; readonly stopReason: string }>,
  sessionID: string,
): WorkflowEvidence {
  const steps = turns
    .filter((t) => t.toolCalls.length > 0)
    .flatMap((t) => t.toolCalls.map((c) => ({ title: c.name, tool: c.name, goal: c.name })))
  const failures = turns.filter((t) => t.stopReason === "error").length
  return {
    planSteps: steps,
    successRate: steps.length === 0 ? 0 : 1 - failures / turns.length,
    executions: 1,
    sessionIDs: [sessionID],
  }
}

/** Renders a skill's steps as an instruction block for prompt injection. */
export function renderSkillSteps(skill: SkillCandidate): string {
  const steps = skill.steps.map((s) => `- ${s.title} (via ${s.ref})`).join("\n")
  return `Learned workflow "${skill.name}" (${skill.evidence.executions} executions, ${Math.round(skill.evidence.successRate * 100)}% success):\n${steps}`
}

export interface LearningStore {
  readonly candidates: ReadonlyArray<SkillCandidate>
  readonly confirm: (id: string) => LearningStore
  readonly reject: (id: string) => LearningStore
}

export function createLearningStore(initial: ReadonlyArray<SkillCandidate> = []): LearningStore {
  const make = (candidates: ReadonlyArray<SkillCandidate>): LearningStore => ({
    candidates,
    confirm: (id) => make(confirmCandidate(candidates, id)),
    reject: (id) => make(rejectCandidate(candidates, id)),
  })
  return make(initial)
}

export function confirmCandidate(candidates: ReadonlyArray<SkillCandidate>, id: string): ReadonlyArray<SkillCandidate> {
  return candidates.map((c) => (c.id === id ? { ...c, status: "confirmed" } : c))
}

export function rejectCandidate(candidates: ReadonlyArray<SkillCandidate>, id: string): ReadonlyArray<SkillCandidate> {
  return candidates.map((c) => (c.id === id ? { ...c, status: "rejected" } : c))
}

/** Candidate skills are usable once confirmed (M10 §10.6 confirmation flow). */
export function usable(candidates: ReadonlyArray<SkillCandidate>): ReadonlyArray<SkillCandidate> {
  return candidates.filter((c) => c.status === "confirmed")
}
