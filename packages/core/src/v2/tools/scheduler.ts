// V2 tool scheduler (M3 §3.6): conflict-graph parallel execution.
// Design source: kimi-code `loop/tool-scheduler.ts` + pi `executeToolCalls`.
export * as Scheduler from "./scheduler"
//
// Three phases per batch:
//   1. preflight (serial): argument shim → schema validation → permission hook
//   2. execution (parallel): conflict-free calls run concurrently; conflicting
//      pairs run serially in source order
//   3. settlement (source order): results are persisted in the assistant's
//      original tool-call order, never completion order
//
// Conflict rules: read vs read = compatible; any write vs overlapping path
// (prefix match incl. recursive containment) = conflict; `global` access
// conflicts with everything. Per-file serialization is the bottom layer.
import { Effect, Semaphore } from "effect"
import type { ToolCall, ToolOutput, ToolFailure } from "@opencode-ai/llm"

export const MAX_CONCURRENCY = 8

export type ToolAccess =
  | { kind: "file"; op: "read" | "write" | "edit"; path: string; recursive?: boolean }
  | { kind: "global" }
  | { kind: "network" }

export interface SchedulableTool {
  readonly name: string
  readonly executionMode?: "parallel" | "sequential"
  readonly access?: ReadonlyArray<ToolAccess>
}

export interface Batch {
  readonly calls: ReadonlyArray<ToolCall>
  readonly tools: ReadonlyArray<SchedulableTool>
  readonly execute: (call: ToolCall) => Effect.Effect<ToolOutput, ToolFailure>
  /** Call-level access override: derive actual paths from call input (e.g. tool args). */
  readonly accessOf?: (call: ToolCall) => ReadonlyArray<ToolAccess>
}

/** Prefix containment: `a` is inside `b` when b is a path prefix of a (or equal). */
export function pathConflicts(a: string, b: string): boolean {
  if (a === b) return true
  return a.startsWith(b.endsWith("/") ? b : `${b}/`) || b.startsWith(a.endsWith("/") ? a : `${a}/`)
}

export function accessesConflict(left: ToolAccess, right: ToolAccess): boolean {
  if (left.kind === "global" || right.kind === "global") return true
  if (left.kind === "network" && right.kind === "network") return true
  if (left.kind === "network" || right.kind === "network") return false
  // both file accesses
  const l = left as { kind: "file"; op: string; path: string; recursive?: boolean }
  const r = right as { kind: "file"; op: string; path: string; recursive?: boolean }
  if (l.op === "read" && r.op === "read") return false
  if (!pathConflicts(l.path, r.path)) return false
  return true
}

function accessFor(tool: SchedulableTool | undefined): ReadonlyArray<ToolAccess> {
  return tool?.access ?? (tool?.executionMode === "sequential" ? [{ kind: "global" }] : [])
}

/**
 * Greedy coloring of the conflict graph: calls sharing no edges run in the
 * same wave; waves execute sequentially. Within a wave, execution is
 * concurrent up to MAX_CONCURRENCY. `accessOf` overrides static tool access
 * with call-derived paths (e.g. the actual file a write targets).
 */
export function planWaves(
  calls: ReadonlyArray<ToolCall>,
  tools: ReadonlyArray<SchedulableTool>,
  accessOf?: (call: ToolCall) => ReadonlyArray<ToolAccess>,
): ToolCall[][] {
  const lookup = new Map(tools.map((t) => [t.name, t]))
  const waves: ToolCall[][] = []
  for (const call of calls) {
    const access = accessOf?.(call) ?? accessFor(lookup.get(call.name))
    let placed = false
    for (const wave of waves) {
      const conflicts = wave.some((other) => {
        const otherTool = lookup.get(other.name)
        if (otherTool?.executionMode === "sequential") return true
        const otherAccess = accessOf?.(other) ?? accessFor(otherTool)
        return access.some((a) => otherAccess.some((b) => accessesConflict(a, b)))
      })
      if (!conflicts) {
        wave.push(call)
        placed = true
        break
      }
    }
    if (!placed) waves.push([call])
  }
  return waves
}

/**
 * Executes the batch. Returns results in the assistant's original call order
 * regardless of completion order.
 */
export function runBatch(batch: Batch): Effect.Effect<ReadonlyArray<ToolOutput>, ToolFailure> {
  return Effect.gen(function* () {
    const semaphore = Semaphore.makeUnsafe(MAX_CONCURRENCY)
    const waves = planWaves(batch.calls, batch.tools, batch.accessOf)
    const settled = new Map<string, ToolOutput>()
    for (const wave of waves) {
      const waveResults = yield* Effect.forEach(
        wave,
        (call) => semaphore.withPermit(batch.execute(call)),
        { concurrency: MAX_CONCURRENCY },
      )
      wave.forEach((call, i) => settled.set(call.id, waveResults[i]))
    }
    return batch.calls.map((call) => settled.get(call.id) as ToolOutput)
  })
}
