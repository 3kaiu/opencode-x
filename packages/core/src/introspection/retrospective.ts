// V2 introspection — session retrospective (C15 P3.6).
// Replays the durable tool decision stream for a session, rebuilds M12 decision
// records, runs the metacognition loop (attribution → lesson sediment → skill
// candidates), and renders a retro report. Consumers: CLI retro command (batch E).
export * as Retrospective from "./retrospective"

import { Effect, Option } from "effect"
import { Observability } from "@opencode-ai/observability"
import { SessionDurable } from "@opencode-ai/schema/durable-event-manifest"
import { SessionEvent } from "@opencode-ai/schema/session-event"
import { Database } from "../database/database"
import { Event } from "../event"
import { Memory } from "../memory/store"
import { Introspection, type DecisionRecord } from "./attribution"
import { Loop, type LoopResult } from "./loop"
import type { SkillCandidate } from "../skills/learn"

export interface RetrospectiveResult extends LoopResult {
  readonly records: ReadonlyArray<DecisionRecord>
  readonly summary: ReturnType<typeof Introspection.summarize>
  readonly report: string
}

type ToolCall = {
  readonly callID: string
  readonly seq: number
  readonly tool: string
  readonly args: unknown
}

type ToolOutcome = {
  readonly outcome: "success" | "failure"
  readonly errorFingerprint?: string
  readonly seq: number
}

// Rebuild per-call records from the durable tool stream. Tool.Called carries
// name+args; Success/Failed resolve the outcome by callID.
const collectRecords = Effect.fn("Retrospective.collectRecords")(function* (
  db: Database.Interface["db"],
  sessionID: string,
) {
  const result = yield* Event.readAggregate(db, {
    aggregateID: sessionID,
    limit: 10_000,
    manifest: SessionDurable,
  })
  const calls = new Map<string, ToolCall>()
  const outcomes = new Map<string, ToolOutcome>()
  for (const event of result.events) {
    const seq = event.durable?.seq ?? 0
    switch (event.type) {
      case "session.next.tool.called":
        calls.set(event.data.callID, { callID: event.data.callID, seq, tool: event.data.tool, args: event.data.input })
        break
      case "session.next.tool.success":
        outcomes.set(event.data.callID, { outcome: "success", seq })
        break
      case "session.next.tool.failed":
        outcomes.set(event.data.callID, {
          outcome: "failure",
          seq,
          errorFingerprint: event.data.error.message,
        })
        break
    }
  }
  const records: DecisionRecord[] = []
  for (const [callID, call] of calls) {
    const outcome = outcomes.get(callID)
    records.push({
      turn: call.seq,
      contextFingerprint: `v2:${call.seq}`,
      action: { tool: call.tool, args: call.args, decision: "tool-call" },
      result: outcome
        ? { outcome: outcome.outcome, errorFingerprint: outcome.errorFingerprint }
        : { outcome: "failure", errorFingerprint: "interrupted" },
      seq: call.seq,
    })
  }
  return records.sort((a, b) => a.seq - b.seq)
})

/**
 * Runs the full retro over a session's durable tool decisions: rebuilds
 * decision records, attributes failures, sediments lessons, and distills
 * skill candidates. Renders a markdown report for the CLI retro command.
 */
export const retrospect = Effect.fn("Retrospective.retrospect")(function* (
  sessionID: string,
  memory: Memory.MemoryStore,
  minSkillExecutions = 2,
) {
  const startedAt = Date.now()
  const db = (yield* Database.Service).db
  const records = yield* collectRecords(db, sessionID)
  const loop = yield* Effect.promise(() => Loop.runMetacognition({ memory }, records, minSkillExecutions))
  const summary = Introspection.summarize(records)
  const observability = yield* Effect.serviceOption(Observability)
  if (Option.isSome(observability)) {
    observability.value.record("counter", "introspection.decisions", {}, records.length)
    observability.value.record("counter", "introspection.failures", {}, summary.failures)
    observability.value.record("timer", "introspection.retrospect", {}, Date.now() - startedAt)
  }
  return {
    records,
    summary,
    lessonID: loop.lessonID,
    candidates: loop.candidates,
    report: renderReport(summary, loop, records.length),
  }
})

function renderReport(
  summary: ReturnType<typeof Introspection.summarize>,
  loop: LoopResult,
  recorded: number,
): string {
  const lines = [
    "# Session Retro",
    "",
    `- tool decisions (recorded): ${recorded}`,
    `- failures: ${summary.failures}`,
    `- success rate: ${(summary.successRate * 100).toFixed(1)}%`,
  ]
  if (summary.topFailures.length > 0) {
    lines.push("", "## Top failure tools")
    for (const { tool, count } of summary.topFailures) {
      lines.push(`- ${tool}: ${count}`)
    }
  }
  if (loop.lessonID !== null) {
    lines.push("", "## Sedimented lesson", "", `- lesson id: \`${loop.lessonID}\``)
  }
  if (loop.candidates.length > 0) {
    lines.push("", "## Skill candidates (awaiting confirmation)")
    for (const candidate of loop.candidates) {
      lines.push(`- ${candidate.name}: ${candidate.description}`)
    }
  }
  if (summary.failures === 0 && loop.candidates.length === 0) {
    lines.push("", "No failures and no new skill candidates in this session.")
  }
  return lines.join("\n")
}

export type { SkillCandidate }
