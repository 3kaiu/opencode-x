// V2 metacognition loop (architecture §0.4 step 9 + §12.4).
// Closes the loop: M12 attribution → M5 lesson sediment → M10 skill learning.
// "犯错的教训不再犯" + "成功的路径沉淀为技能"。
export * as Loop from "./loop"

import { Introspection, type AttributionChain, type DecisionRecord } from "../introspection/attribution"
import { lessonFor } from "../introspection/attribution"
import { Sediment, type SedimentSignal } from "../memory/sediment"
import { Memory } from "../memory/store"
import { Learn, type WorkflowEvidence, type SkillCandidate } from "../skills/learn"

export interface LoopContext {
  readonly memory: Memory.MemoryStore
}

/**
 * 1. Attribution → lesson sediment: after a failure, persist the lesson as a
 * pending memory entry (M5). Reuses M12 attribution to pick the root cause.
 */
export async function sedimentLesson(
  ctx: LoopContext,
  record: DecisionRecord,
  attribution: AttributionChain,
): Promise<string | null> {
  const lesson = lessonFor(attribution, record.action.tool)
  const signal: SedimentSignal = {
    kind: "tool.failed",
    tool: record.action.tool,
    error: record.result.errorFingerprint ?? attribution.rootCause,
    category: attribution.rootCause === "missing-context" ? "NotFound" : attribution.rootCause === "tool-misuse" ? "Permission" : undefined,
    at: Date.now(),
  }
  const entry = await Sediment.recordPending(ctx.memory, signal)
  if (entry) {
    // enrich the generic lesson entry with the attribution-specific lesson
    await Memory.appendWire(ctx.memory, {
      type: "memory.upsert",
      entry: { ...entry, content: lesson, title: `${record.action.tool}: ${attribution.rootCause}`, updated_at: Date.now() },
    })
    return entry.id
  }
  return null
}

export interface LoopResult {
  readonly lessonID: string | null
  readonly candidates: ReadonlyArray<SkillCandidate>
}

/**
 * Full metacognition pass over a session's records:
 *   - failures → lessons (M12 → M5)
 *   - successful workflow sequences → candidate skills (M8 → M10, pending)
 * Returns lesson ID and any skill candidates awaiting confirmation.
 */
export async function runMetacognition(
  ctx: LoopContext,
  records: ReadonlyArray<DecisionRecord>,
  minSkillExecutions = 2,
): Promise<LoopResult> {
  let lessonID: string | null = null
  for (const record of records) {
    if (record.result.outcome !== "failure") continue
    const attribution = Introspection.attribute(record, [])
    const id = await sedimentLesson(ctx, record, attribution)
    if (id !== null && lessonID === null) lessonID = id
  }
  const evidence = Learn.evidenceFromSession(records)
  // Single-session evidence distills directly when execution count is met;
  // cross-session aggregation happens at the learning store level.
  const candidates = evidence ? Learn.distillSkill(evidence, minSkillExecutions) : null
  return { lessonID, candidates: candidates ? [candidates] : [] }
}

/** Promotes a lesson to confirmed after reuse (M5 confirmation flow). */
export async function confirmLessonAfterReuse(ctx: LoopContext, lessonID: string, reuseCount: number): Promise<boolean> {
  return Sediment.promoteIfReused(ctx.memory, lessonID, reuseCount)
}

export { lessonFor, type WorkflowEvidence }
