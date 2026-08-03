// V2 orchestrator — single turn loop wiring M1→M2→M3→M6 (architecture §0.4).
//
// One turn:
//   input (user/steer) → M1 project (layers + budgets) → provider request
//   → tool calls settle via M3 scheduler (conflict-graph parallel)
//   → M6 lifecycle events published throughout
//   → next turn until no tool calls remain.
//
// The orchestrator is provider-agnostic: it accepts a `stream` function that
// performs exactly one llm.stream call and emits streamed events, matching the
// architecture rule "one explicit llm.stream per provider turn".
export * as Orchestrator from "./orchestrator"

import { Effect, Ref, Schedule } from "effect"
import { LLMClient, Message, Model, ToolDefinition, ToolOutput, type ToolContent } from "@opencode-ai/llm"
import { Projection, type ProjectionInput, type ProjectionResult } from "../context/projection"
import { ContextBudget } from "../context/budget"
import { Scheduler, type SchedulableTool } from "../tools/scheduler"
import { Lifecycle, type ToolLifecycleEvent } from "../events/lifecycle"
import { Isolation } from "../security/isolation"
import { Planning, type PlanNode, type Drift } from "../planning/plan"
import { Provider } from "./provider"

export interface StreamedEvent {
  readonly kind: "text" | "thinking" | "toolcall"
  readonly phase: "start" | "delta" | "end"
  readonly content?: string
  readonly tool?: { readonly id: string; readonly name: string; readonly input: unknown }
}

export interface ProviderTurn {
  readonly request: () => Effect.Effect<{ readonly events: ReadonlyArray<StreamedEvent>; readonly stopReason: string }, unknown>
}

export interface TurnInput {
  readonly prompt: string
  readonly source: "user" | "steer" | "queue"
  readonly system: ReadonlyArray<Projection.ProjectedPiece>
  readonly world: ReadonlyArray<Projection.ProjectedPiece>
  readonly instructions: ReadonlyArray<Projection.ProjectedPiece>
  readonly memory: ReadonlyArray<Projection.ProjectedPiece>
  readonly history: ReadonlyArray<Projection.ProjectedPiece>
  readonly live: ReadonlyArray<Projection.ProjectedPiece>
  readonly tools: ReadonlyArray<SchedulableTool>
  /** Structured assistant tool-call / tool-result message pairs from prior turns. */
  readonly toolHistory?: ReadonlyArray<Message>
  /** Steer inputs buffered behind the main prompt; consumed one per idle turn (M6). */
  readonly queuedSteer?: ReadonlyArray<string>
  /** Call-level access derivation for conflict-graph scheduling (M4). */
  readonly accessForCall?: (call: { readonly name: string; readonly input: unknown }) => ReadonlyArray<Scheduler.ToolAccess>
  readonly settle: (call: { readonly id: string; readonly name: string; readonly input: unknown }) => Effect.Effect<unknown, unknown>
}

export interface TurnResult {
  readonly projection: ProjectionResult
  readonly lifecycle: ReadonlyArray<ToolLifecycleEvent>
  readonly toolCalls: ReadonlyArray<{ readonly id: string; readonly name: string; readonly input: unknown }>
  readonly toolOutputs: ReadonlyArray<string>
  readonly toolMessages: ReadonlyArray<Message>
  readonly stopReason: string
  readonly text: string
  readonly fingerprint: string
}

/** Joins the streamed text deltas of a turn (the model's visible prose). */
function turnText(events: ReadonlyArray<StreamedEvent>): string {
  return events
    .filter((e) => e.kind === "text" && e.phase === "delta" && e.content)
    .map((e) => e.content as string)
    .join("")
}

/** Renders a settled ToolOutput into plain text for the next turn's context. */
function renderOutput(out: ToolOutput): string {
  const text = out.content
    .map((c) => (c.type === "text" ? c.text : JSON.stringify(c)))
    .join("\n")
  if (text) return text
  return out.structured === null || out.structured === undefined ? "(no output)" : JSON.stringify(out.structured)
}

/** Builds the structured assistant tool-call / tool-result message pair. */
function toolMessagePair(
  call: { readonly id: string; readonly name: string; readonly input: unknown },
  output: string,
): ReadonlyArray<Message> {
  return [
    Message.assistant([{ type: "tool-call", id: call.id, name: call.name, input: call.input }]),
    Message.tool({ id: call.id, name: call.name, result: { type: "text", value: output } }),
  ]
}

/** Dedup key: models sometimes emit the same call twice in one turn. */
function callKey(call: { readonly name: string; readonly input: unknown }): string {
  return `${call.name}:${JSON.stringify(call.input)}`
}

/** Keeps the first occurrence of each identical call; duplicates share its output. */
function dedupeCalls<T extends { readonly name: string; readonly input: unknown }>(calls: ReadonlyArray<T>): {
  readonly unique: ReadonlyArray<T>
  readonly keyOf: (call: T) => string
} {
  const seen = new Set<string>()
  const unique: T[] = []
  for (const call of calls) {
    const key = callKey(call)
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(call)
  }
  return { unique, keyOf: callKey }
}

export interface OrchestratorDeps {
  readonly runProviderTurn: (projection: ProjectionResult, prompt: string, toolHistory?: ReadonlyArray<Message>) => Effect.Effect<{
    readonly events: ReadonlyArray<StreamedEvent>
    readonly stopReason: string
  }, unknown>
  /** M9 auto-trigger: runs after a turn with writes; reports feed the next turn. */
  readonly autoVerify?: (writtenPaths: ReadonlyArray<string>) => Effect.Effect<ReadonlyArray<string>, unknown>
}

/**
 * Runs one turn: project context → provider stream → settle tool calls with
 * the conflict-graph scheduler → collect lifecycle events. Settle return
 * values are rendered into `toolOutputs` for the next turn's context.
 */
export function runTurn(input: TurnInput & OrchestratorDeps): Effect.Effect<TurnResult, unknown> {
  return Effect.gen(function* () {
    const projection = Projection.project({
      window: 20_000,
      system: input.system,
      world: input.world,
      instructions: input.instructions,
      memory: input.memory,
      history: input.history,
      live: input.live,
    })

    const tracker = Lifecycle.createTracker()
    const response = yield* input.runProviderTurn(projection, input.prompt, input.toolHistory)

    // Collect tool calls from streamed events (toolcall.end carries the call).
    const toolCalls: Array<{ readonly id: string; readonly name: string; readonly input: unknown }> = []
    let seq = 0
    for (const event of response.events) {
      if (event.kind === "toolcall" && event.phase === "end" && event.tool) {
        toolCalls.push(event.tool)
      }
    }

    let toolOutputs: ReadonlyArray<string> = []
    let toolMessages: ReadonlyArray<Message> = []
    if (toolCalls.length > 0) {
      const { unique, keyOf } = dedupeCalls(toolCalls)
      // M3 conflict-graph parallel settlement; lifecycle events published.
      for (const call of unique) {
        tracker.started(call.name, call.id, ++seq)
      }
            const results = yield* Scheduler.runBatch({
        calls: unique.map((t) => ({ type: "tool-call" as const, id: t.id, name: t.name, input: t.input })),
        tools: input.tools,
        accessOf: input.accessForCall,
        execute: (call) =>
          Effect.gen(function* () {
            const out = yield* input.settle(call)
            const content: ReadonlyArray<ToolContent> =
              typeof out === "string"
                ? [{ type: "text", text: out }]
                : out === null || out === undefined
                  ? []


                  : [{ type: "text", text: JSON.stringify(out) }]
            return ToolOutput.make(null, content)
          }).pipe(
            Effect.catch(() =>
              Effect.sync(() => {
                tracker.failed(call.name, call.id, "execution failed", ++seq)
                return ToolOutput.make(null, [])
              }),
            ),
          ),
      }).pipe(Effect.catch(() => Effect.succeed([])))
      const outputByKey = new Map<string, string>()
      unique.forEach((call, i) => outputByKey.set(keyOf(call), results[i] ? renderOutput(results[i]) : "(no output)"))
      toolOutputs = toolCalls.map((call) => outputByKey.get(keyOf(call)) ?? "(no output)")
      toolMessages = unique.flatMap((call) => toolMessagePair(call, outputByKey.get(keyOf(call)) ?? "(no output)"))
      unique.forEach((call) => tracker.completed(call.name, call.id, 0, ++seq))
    }

    return {
      projection,
      lifecycle: tracker.events(),
      toolCalls,
      toolOutputs,
      toolMessages,
      stopReason: response.stopReason,
      text: turnText(response.events),
      fingerprint: projection.fingerprint,
    }
  })
}

/** Sequential turn loop until the provider stops requesting tools. */
export function runLoop(
  deps: OrchestratorDeps,
  initialState: TurnInput,
  maxTurns = 20,
): Effect.Effect<{ readonly turns: ReadonlyArray<TurnResult>; readonly finalPrompt: string }, unknown> {
  return Effect.gen(function* () {
    const turns: TurnResult[] = []
    const queue = [...(initialState.queuedSteer ?? [])]
    let state = initialState
    for (let i = 0; i < maxTurns; i++) {
      const turn = yield* runTurn({ ...state, ...deps })
      turns.push(turn)
      if (turn.toolCalls.length > 0) {
        // Next turn: structured tool messages feed back so the model sees results.
        state = {
          ...state,
          history: [
            ...state.history,
            ...turn.toolCalls.map(
              (t, i) => Projection.piece.history(`[tool] ${t.name} → ${turn.toolOutputs[i] ?? "(no output)"}`),
            ),
          ],
          toolHistory: [...(state.toolHistory ?? []), ...turn.toolMessages],
        }
      }
      if (deps.autoVerify) {
        const paths = turn.toolCalls.map(writtenPath).filter((p): p is string => p !== null)
        if (paths.length > 0) {
          const reports = yield* deps.autoVerify(paths)
          if (reports.length > 0) {
            state = { ...state, history: [...state.history, ...reports.map((r) => Projection.piece.history(`[verify] ${r}`))] }
          }
        }
      }
      if (turn.stopReason === "end" || turn.toolCalls.length === 0) {
        // Step boundary: flush the next buffered steer, if any (M6, kimi steerBuffer).
        const next = queue.shift()
        if (next === undefined) break
        state = {
          ...state,
          prompt: next,
          source: "steer",
          history: [...state.history, Projection.piece.history(`[user] ${next}`)],
        }
      }
    }
    return { turns, finalPrompt: state.prompt }
  })
}

export interface RealTurnInput {
  readonly prompt: string
  readonly model: Model
  readonly llm: Provider.LlmStreamer
  readonly system: ReadonlyArray<Projection.ProjectedPiece>
  readonly world: ReadonlyArray<Projection.ProjectedPiece>
  readonly instructions: ReadonlyArray<Projection.ProjectedPiece>
  readonly memory: ReadonlyArray<Projection.ProjectedPiece>
  readonly history: ReadonlyArray<Projection.ProjectedPiece>
  readonly live: ReadonlyArray<Projection.ProjectedPiece>
  readonly tools: ReadonlyArray<{ readonly name: string; readonly definition: ToolDefinition.Input }>
  /** Structured assistant tool-call / tool-result message pairs from prior turns. */
  readonly toolHistory?: ReadonlyArray<Message>
  /** Call-level access derivation for conflict-graph scheduling (M4). */
  readonly accessForCall?: (call: { readonly name: string; readonly input: unknown }) => ReadonlyArray<Scheduler.ToolAccess>
  readonly settle: (call: { readonly id: string; readonly name: string; readonly input: unknown }) => Effect.Effect<unknown, unknown>
  readonly onUsage?: (usage: Provider.Usage) => void
  readonly window?: number
}

/**
 * One full real turn: M1 projection → buildRequest → LLMClient.stream →
 * collect events → settle tool calls via the M3 scheduler → lifecycle events.
 * Settle return values are rendered into `toolOutputs` for the next turn.
 */
export function runTurnWithProvider(input: RealTurnInput): Effect.Effect<TurnResult, unknown> {
  return Effect.gen(function* () {
    const projection = Projection.project({
      window: input.window ?? 20_000,
      system: input.system,
      world: input.world,
      instructions: input.instructions,
      memory: input.memory,
      history: input.history,
      live: input.live,
    })
    const request = Provider.buildRequest({
      projection,
      model: input.model,
      tools: input.tools,
      prompt: input.prompt,
      toolHistory: input.toolHistory,
    })
    const response = yield* Provider.streamTurn({ llm: input.llm, request, onUsage: input.onUsage })
    const tracker = Lifecycle.createTracker()
    const toolCalls = response.events
      .filter((e) => e.kind === "toolcall" && e.phase === "end" && e.tool)
      .map((e) => e.tool!)
    let seq = 0
    let toolOutputs: ReadonlyArray<string> = []
    let toolMessages: ReadonlyArray<Message> = []
    if (toolCalls.length > 0) {
      const { unique, keyOf } = dedupeCalls(toolCalls)
      for (const call of unique) tracker.started(call.name, call.id, ++seq)
      const results = yield* Scheduler.runBatch({
        calls: unique.map((t) => ({ type: "tool-call" as const, id: t.id, name: t.name, input: t.input })),
        tools: input.tools.map((t) => ({ name: t.name })),
        accessOf: input.accessForCall,
        execute: (call) =>
          Effect.gen(function* () {
            const out = yield* input.settle(call)
            const content: ReadonlyArray<ToolContent> =
              typeof out === "string"
                ? [{ type: "text", text: out }]
                : out === null || out === undefined
                  ? []
                  : [{ type: "text", text: JSON.stringify(out) }]
            return ToolOutput.make(null, content)
          }).pipe(
            Effect.catch(() =>
              Effect.sync(() => {
                tracker.failed(call.name, call.id, "execution failed", ++seq)
                return ToolOutput.make(null, [])
              }),
            ),
          ),
      }).pipe(Effect.catch(() => Effect.succeed([])))
      const outputByKey = new Map<string, string>()
      unique.forEach((call, i) => outputByKey.set(keyOf(call), results[i] ? renderOutput(results[i]) : "(no output)"))
      toolOutputs = toolCalls.map((call) => outputByKey.get(keyOf(call)) ?? "(no output)")
      toolMessages = unique.flatMap((call) => toolMessagePair(call, outputByKey.get(keyOf(call)) ?? "(no output)"))
      unique.forEach((call) => tracker.completed(call.name, call.id, 0, ++seq))
    }
    return {
      projection,
      lifecycle: tracker.events(),
      toolCalls,
      toolOutputs,
      toolMessages,
      stopReason: response.stopReason,
      text: turnText(response.events),
      fingerprint: projection.fingerprint,
    }
  })
}

export interface PlanResult {
  readonly turns: ReadonlyArray<TurnResult>
  readonly completed: ReadonlyArray<string>
  readonly blocked: ReadonlyArray<string>
  readonly drift: ReadonlyArray<Drift>
  readonly finalPrompt: string
}

/** Extracts a written path from a tool call, if the call is a write-style tool. */
function writtenPath(call: { readonly name: string; readonly input: unknown }): string | null {
  if (!/write|edit|apply|patch/i.test(call.name)) return null
  const input = call.input as { path?: unknown }
  return typeof input?.path === "string" ? input.path : null
}

/**
 * Goal-driven turn sequence (M8 §8.6): walks the plan tree, running one
 * provider turn per ready node with the node's goal as prompt. A node is
 * complete when the external `verify` accepts it; retries are capped per node
 * and out-of-scope writes are recorded as drift.
 */
export function runPlan(
  deps: OrchestratorDeps,
  initialState: TurnInput,
  planNodes: ReadonlyArray<PlanNode>,
  verify: (node: PlanNode, turn: TurnResult) => boolean,
  scopedPaths: ReadonlyArray<string> = [],
  maxTurnsPerNode = 3,
): Effect.Effect<PlanResult, unknown> {
  return Effect.gen(function* () {
    const store = Planning.createPlan(planNodes)
    const statusMap = new Map(planNodes.map((n) => [n.id, n.status]))
    const isReady = (node: PlanNode) => node.dependsOn.every((dep) => statusMap.get(dep) === "done")
    const turns: TurnResult[] = []
    const drift: Drift[] = []
    let state = initialState
    let guard = 0
    while (guard++ < 200) {
      const node = planNodes.find((n) => statusMap.get(n.id) === "pending" && isReady(n))
      if (!node) break
      let attempts = 0
      while (attempts < maxTurnsPerNode) {
        attempts++
        const turn = yield* runTurn({ ...state, prompt: node.goal, ...deps })
        turns.push(turn)
        for (const call of turn.toolCalls) {
          const path = writtenPath(call)
          if (path) {
            const d = Planning.detectDrift(path, store, scopedPaths)
            if (d) drift.push(d)
          }
        }
        state = {
          ...state,
          history: [...state.history, ...turn.toolCalls.map((t, i) => Projection.piece.history(`[tool] ${t.name} → ${turn.toolOutputs[i] ?? "(no output)"}`))],
          toolHistory: [...(state.toolHistory ?? []), ...turn.toolMessages],
        }
        if (deps.autoVerify) {
          const paths = turn.toolCalls.map(writtenPath).filter((p): p is string => p !== null)
          if (paths.length > 0) {
            const reports = yield* deps.autoVerify(paths)
            if (reports.length > 0) {
              state = { ...state, history: [...state.history, ...reports.map((r) => Projection.piece.history(`[verify] ${r}`))] }
            }
          }
        }
        if (verify(node, turn)) {
          statusMap.set(node.id, "done")
          break
        }
      }
      if (statusMap.get(node.id) !== "done") {
        statusMap.set(node.id, "blocked")
      }
    }
    return {
      turns,
      completed: [...statusMap.entries()].filter(([, s]) => s === "done").map(([id]) => id),
      blocked: [...statusMap.entries()].filter(([, s]) => s === "blocked").map(([id]) => id),
      drift,
      finalPrompt: state.prompt,
    }
  })
}
