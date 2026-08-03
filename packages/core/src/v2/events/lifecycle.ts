// V2 events — execution feedback stream (M6 §6.3/§6.6).
// tool lifecycle events with heartbeat (>60s), progress, and error-encoded
// final messages. Design: pi "errors are messages, stream never rejects".
export * as Lifecycle from "./lifecycle"

export type ToolPhase = "started" | "running" | "completed" | "failed"

export interface ToolLifecycleEvent {
  readonly phase: ToolPhase
  readonly tool: string
  readonly callID: string
  readonly progress?: { readonly pct?: number; readonly note?: string }
  readonly durationMs?: number
  readonly seq: number
}

export interface StreamedMessage {
  readonly kind: "text" | "thinking" | "toolcall"
  readonly phase: "start" | "delta" | "end"
  readonly content?: string
}

export interface FinalMessage {
  readonly text: string
  readonly stopReason: "end" | "tool_use" | "length" | "error" | "aborted"
  readonly errorMessage?: string
}

export interface LifecycleTracker {
  readonly started: (tool: string, callID: string, seq: number) => void
  readonly running: (tool: string, callID: string, progress: { pct?: number; note?: string }, seq: number) => void
  readonly completed: (tool: string, callID: string, durationMs: number, seq: number) => void
  readonly failed: (tool: string, callID: string, error: string, seq: number) => void
  readonly events: () => ReadonlyArray<ToolLifecycleEvent>
  readonly heartbeat: (now: number) => ReadonlyArray<ToolLifecycleEvent>
}

export interface LifecycleOptions {
  readonly heartbeatAfterMs?: number   // default 60_000
}

/** Tracks active tool phases; heartbeat re-emits running for long tools. */
export function createTracker(options: LifecycleOptions = {}): LifecycleTracker {
  const opts = { heartbeatAfterMs: 60_000, ...options }
  let events: ToolLifecycleEvent[] = []
  const active = new Map<string, { startedAt: number; lastBeat: number }>()

  const emit = (event: ToolLifecycleEvent) => {
    events = [...events, event]
  }

  return {
    started(tool, callID, seq) {
      active.set(callID, { startedAt: Date.now(), lastBeat: Date.now() })
      emit({ phase: "started", tool, callID, seq })
    },
    running(tool, callID, progress, seq) {
      active.set(callID, { startedAt: active.get(callID)?.startedAt ?? Date.now(), lastBeat: Date.now() })
      emit({ phase: "running", tool, callID, progress, seq })
    },
    completed(tool, callID, durationMs, seq) {
      active.delete(callID)
      emit({ phase: "completed", tool, callID, durationMs, seq })
    },
    failed(tool, callID, error, seq) {
      active.delete(callID)
      emit({ phase: "failed", tool, callID, progress: { note: error }, seq })
    },
    events() {
      return events
    },
    heartbeat(now) {
      const beats: ToolLifecycleEvent[] = []
      for (const [callID, state] of active) {
        if (now - state.lastBeat >= opts.heartbeatAfterMs) {
          beats.push({ phase: "running", tool: "?", callID, progress: { note: "still running" }, seq: 0 })
          active.set(callID, { ...state, lastBeat: now })
        }
      }
      if (beats.length > 0) events = [...events, ...beats]
      return beats
    },
  }
}

/** Stream contract: errors are encoded into the final message, never thrown. */
export function finalize(chunks: ReadonlyArray<StreamedMessage>, stopReason: FinalMessage["stopReason"]): FinalMessage {
  const text = chunks
    .filter((c) => c.kind === "text" && c.phase !== "start")
    .map((c) => c.content ?? "")
    .join("")
  const thinking = chunks
    .filter((c) => c.kind === "thinking" && c.phase !== "start")
    .map((c) => c.content ?? "")
    .join("")
  return {
    text,
    stopReason,
    ...(thinking ? { errorMessage: undefined } : {}),
  }
}
