// V2 memory — automatic sedimentation (M5 §5.6).
// Extracts lessons (tool failures) and preferences (permission decisions)
// from the event stream; entries start `pending` and are promoted to
// `confirmed` by user confirmation or 3 successful reuses.
export * as Sediment from "./sediment"

import type { MemoryEntry } from "./store"
import { Memory, nextID } from "./store"

export interface FailureSignal {
  readonly kind: "tool.failed"
  readonly tool: string
  readonly error: string
  readonly category?: string
  readonly sessionID?: string
  readonly at: number
}

export interface PermissionSignal {
  readonly kind: "permission.decision"
  readonly action: string
  readonly resource: string
  readonly decision: "allow" | "deny" | "ask"
  readonly at: number
}

export type SedimentSignal = FailureSignal | PermissionSignal

export interface SedimentRule {
  readonly match: (signal: SedimentSignal) => boolean
  readonly makeEntry: (signal: SedimentSignal) => Omit<MemoryEntry, "id" | "created_at" | "updated_at" | "status">
}

const LESSON_RULES: ReadonlyArray<SedimentRule> = [
  {
    match: (s) => s.kind === "tool.failed" && s.category === "NotFound",
    makeEntry: (s) =>
      s.kind === "tool.failed"
        ? {
            category: "lesson",
            title: `${s.tool}: probe before acting`,
            content: `Using ${s.tool} failed with NotFound (${s.error.slice(0, 200)}). Probe the environment (M2) before retrying.`,
            keywords: [s.tool, "notfound", "probe"],
            sourceRef: `tool-failure:${s.sessionID ?? "?"}`,
          }
        : (() => {
            throw new Error("unreachable")
          })(),
  },
  {
    match: (s) => s.kind === "tool.failed" && s.category === "Assertion",
    makeEntry: (s) =>
      s.kind === "tool.failed"
        ? {
            category: "lesson",
            title: `${s.tool}: verify after every write`,
            content: `After editing a file, immediately run the tests (${s.error.slice(0, 200)}). If tests fail, re-read the file and check the change against the assertion before editing again.`,
            keywords: [s.tool, "assertion", "verify", "test"],
            sourceRef: `tool-failure:${s.sessionID ?? "?"}`,
          }
        : (() => {
            throw new Error("unreachable")
          })(),
  },
  {
    match: (s) => s.kind === "tool.failed" && s.category === "Timeout",
    makeEntry: (s) =>
      s.kind === "tool.failed"
        ? {
            category: "lesson",
            title: `${s.tool}: watch long-running commands`,
            content: `Using ${s.tool} timed out. Prefer bounded timeouts and heartbeat awareness for long commands.`,
            keywords: [s.tool, "timeout", "heartbeat"],
            sourceRef: `tool-failure:${s.sessionID ?? "?"}`,
          }
        : (() => {
            throw new Error("unreachable")
          })(),
  },
]

const PREFERENCE_RULES: ReadonlyArray<SedimentRule> = [
  {
    match: (s) => s.kind === "permission.decision" && s.decision === "deny",
    makeEntry: (s) =>
      s.kind === "permission.decision"
        ? {
            category: "feedback",
            title: `avoid ${s.action} on ${s.resource}`,
            content: `User denied ${s.action} on ${s.resource}. Treat as a preference: do not attempt again without asking.`,
            keywords: [s.action, s.resource, "deny", "preference"],
            sourceRef: "permission-decision",
          }
        : (() => {
            throw new Error("unreachable")
          })(),
  },
]

/** Applies sediment rules to a signal; returns a pending entry or null. */
export function sedimentSignal(signal: SedimentSignal): Omit<MemoryEntry, "id" | "created_at" | "updated_at" | "status"> | null {
  const rules = signal.kind === "tool.failed" ? LESSON_RULES : PREFERENCE_RULES
  for (const rule of rules) {
    if (rule.match(signal)) return rule.makeEntry(signal)
  }
  return null
}

/** Persists a pending entry via the wire log. */
export async function recordPending(store: Memory.MemoryStore, signal: SedimentSignal): Promise<MemoryEntry | null> {
  const base = sedimentSignal(signal)
  if (!base) return null
  const now = Date.now()
  const entry: MemoryEntry = {
    ...base,
    id: nextID(),
    created_at: now,
    updated_at: now,
    status: "pending",
  }
  await Memory.appendWire(store, { type: "memory.upsert", entry })
  return entry
}

/** Promotion: user confirmation or reuse count >= 3. */
export const REUSE_PROMOTION_THRESHOLD = 3

export async function promoteIfReused(
  store: Memory.MemoryStore,
  entryID: string,
  reuseCount: number,
): Promise<boolean> {
  if (reuseCount < REUSE_PROMOTION_THRESHOLD) return false
  const entries = await Memory.replayWire(store)
  const entry = entries.get(entryID)
  if (!entry || entry.status === "confirmed") return false
  await Memory.appendWire(store, {
    type: "memory.upsert",
    entry: { ...entry, status: "confirmed", updated_at: Date.now() },
  })
  return true
}
