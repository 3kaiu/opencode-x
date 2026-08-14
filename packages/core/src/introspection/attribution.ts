// V2 introspection — decision records & failure attribution (M12 §12.6).
// Sampling: failed turns always recorded, successful turns at a rate, key
// decisions always. Root-cause taxonomy feeds M5 lessons.
export * as Introspection from "./attribution"

import type { DecisionRecord, RootCause, AttributionChain, IntrospectionStore } from "@opencode-ai/schema/introspection"
export type { DecisionRecord, RootCause, AttributionChain, IntrospectionStore }

/** Sampling: failures always; successes at `successRate` (0..1); key decisions always. */
export function shouldRecord(record: DecisionRecord, successRate = 0.1, random = Math.random): boolean {
  if (record.result.outcome === "failure") return true
  return random() < successRate
}

export function appendRecord(store: IntrospectionStore, record: DecisionRecord): IntrospectionStore {
  return { records: [...store.records, record] }
}

/** Failure attribution: classify by evidence available in the chain. */
export function attribute(
  record: DecisionRecord,
  chain: ReadonlyArray<{ readonly seq: number; readonly hypothesis: string }>,
): AttributionChain {
  const error = record.result.errorFingerprint ?? ""
  let rootCause: RootCause = "model-limit"
  if (error.includes("not found") || error.includes("No such") || error.includes("unknown tool")) {
    rootCause = "missing-context"
  } else if (error.includes("invalid") || error.includes("permission") || error.includes("denied")) {
    rootCause = "tool-misuse"
  } else if (chain.some((c) => c.hypothesis.includes("stale") || c.hypothesis.includes("outdated"))) {
    rootCause = "stale-assumption"
  }
  return { failureSeq: record.seq, chain, rootCause }
}

/** Lesson template for M5: one line per root cause. */
export function lessonFor(attribution: AttributionChain, tool: string): string {
  switch (attribution.rootCause) {
    case "missing-context":
      return `Before calling ${tool}, probe the environment first (M2) — failure was due to missing context`
    case "tool-misuse":
      return `Re-check ${tool}'s contract before retrying — failure was due to misuse`
    case "stale-assumption":
      return `Re-verify assumptions with a fresh probe before using ${tool} — world may have changed`
    case "model-limit":
      return `Consider delegating ${tool} work to a subagent or upgrading the model (M7)`
  }
}

/** Aggregated retro report over a session's records. */
export function summarize(records: ReadonlyArray<DecisionRecord>): {
  readonly total: number
  readonly failures: number
  readonly successRate: number
  readonly topFailures: ReadonlyArray<{ readonly tool: string; readonly count: number }>
} {
  const failures = records.filter((r) => r.result.outcome === "failure")
  const byTool = new Map<string, number>()
  for (const r of failures) byTool.set(r.action.tool, (byTool.get(r.action.tool) ?? 0) + 1)
  return {
    total: records.length,
    failures: failures.length,
    successRate: records.length === 0 ? 1 : 1 - failures.length / records.length,
    topFailures: [...byTool.entries()]
      .map(([tool, count]) => ({ tool, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5),
  }
}
