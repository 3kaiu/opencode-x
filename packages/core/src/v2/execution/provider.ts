// V2 provider adapter — bridges the orchestrator (M1 projection) to the real
// LLMClient.stream (architecture rule: exactly one llm.stream per provider
// turn). Maps LLMEvent → StreamedEvent; assembles LLMRequest from the six
// projected layers; collects usage for M7 ledger.
export * as Provider from "./provider"

import { Effect, Stream } from "effect"
import { LLMClient, Model, Message, LLMRequest, ToolChoice, ToolDefinition, type LLMEvent } from "@opencode-ai/llm"
import { Projection } from "../context/projection"

export interface ProviderTurnResult {
  readonly events: ReadonlyArray<StreamedEvent>
  readonly stopReason: string
  readonly usage?: Usage
}

export interface Usage {
  readonly input?: number
  readonly output?: number
  readonly cacheRead?: number
  readonly cacheWrite?: number
  readonly reasoning?: number
  readonly cost?: number
}

export interface StreamedEvent {
  readonly kind: "text" | "thinking" | "toolcall"
  readonly phase: "start" | "delta" | "end"
  readonly content?: string
  readonly tool?: { readonly id: string; readonly name: string; readonly input: unknown }
}

/** Structural LLM streaming service (satisfied by LLMClient.Service). */
export interface LlmStreamer {
  readonly stream: (request: LLMRequest) => Stream.Stream<LLMEvent, unknown>
}

/** Maps LLM finish reasons into the V2 vocabulary (end/tool_use/length/error/aborted). */
function normalizeReason(reason: string): string {
  if (reason === "stop") return "end"
  if (reason === "tool-calls") return "tool_use"
  if (reason === "length") return "length"
  return "error"
}

/**
 * Maps an LLMEvent stream into StreamedEvent list, collects tool calls, and
 * returns the final stop reason. Errors surface as `stopReason: "error"`
 * (pi: errors are messages, never thrown).
 */
export function collectEvents(
  stream: Stream.Stream<LLMEvent, unknown>,
  onUsage?: (usage: Usage) => void,
): Effect.Effect<ProviderTurnResult, unknown> {
  return Effect.gen(function* () {
    const events: StreamedEvent[] = []
    const toolInputs = new Map<string, string>()
    const toolNames = new Map<string, string>()
    let stopReason = "end"
    let usage: Usage | undefined
    yield* Stream.runForEach(stream, (event) =>
      Effect.sync(() => {
        switch (event.type) {
          case "text-start":
            events.push({ kind: "text", phase: "start" })
            break
          case "text-delta":
            events.push({ kind: "text", phase: "delta", content: event.text })
            break
          case "text-end":
            events.push({ kind: "text", phase: "end" })
            break
          case "reasoning-start":
            events.push({ kind: "thinking", phase: "start" })
            break
          case "reasoning-delta":
            events.push({ kind: "thinking", phase: "delta", content: event.text })
            break
          case "reasoning-end":
            events.push({ kind: "thinking", phase: "end" })
            break
          case "tool-input-start":
            toolNames.set(event.id, event.name)
            toolInputs.set(event.id, "")
            events.push({ kind: "toolcall", phase: "start", tool: { id: event.id, name: event.name, input: undefined } })
            break
          case "tool-input-delta":
            toolInputs.set(event.id, (toolInputs.get(event.id) ?? "") + event.text)
            break
          case "tool-input-end": {
            const name = toolNames.get(event.id) ?? event.name
            const raw = toolInputs.get(event.id) ?? ""
            let input: unknown = raw
            try {
              input = raw ? JSON.parse(raw) : {}
            } catch {
              input = raw
            }
            events.push({ kind: "toolcall", phase: "end", tool: { id: event.id, name, input } })
            break
          }
          case "tool-call":
            events.push({ kind: "toolcall", phase: "end", tool: { id: event.id, name: event.name, input: event.input } })
            break
          case "finish":
            stopReason = normalizeReason(event.reason)
            if (event.usage) {
              usage = {
                input: event.usage.inputTokens,
                output: event.usage.outputTokens,
                cacheRead: event.usage.cacheReadInputTokens,
                cacheWrite: event.usage.cacheWriteInputTokens,
                reasoning: event.usage.reasoningTokens,
              }
              onUsage?.(usage)
            }
            break
          case "provider-error":
            stopReason = "error"
            break
          default:
            break
        }
      }),
    )
    return { events, stopReason, ...(usage ? { usage } : {}) }
  }).pipe(Effect.catch(() => Effect.succeed({ events: [] as StreamedEvent[], stopReason: "error" as string })))
}

/**
 * Assembles an LLMRequest from the projected layers. Tools are the top-level
 * (static + promoted) tool definitions. Uses the projection fingerprint as
 * request id for traceability (M12).
 */
export function buildRequest(input: {
  readonly projection: Projection.ProjectionResult
  readonly model: Model
  readonly tools: ReadonlyArray<{ readonly name: string; readonly definition: ToolDefinition.Input }>
  readonly prompt: string
  readonly toolChoice?: "auto" | "none" | "required"
  /** Structured assistant tool-call / tool-result pairs placed before the prompt. */
  readonly toolHistory?: ReadonlyArray<Message>
}): LLMRequest.Input {
  const layers = input.projection.layers
  const system: ReadonlyArray<{ readonly type: "text"; readonly text: string }> = [
    layers.system,
    layers.world,
    layers.instructions,
    layers.memory,
  ]
    .filter((text) => text.length > 0)
    .map((text) => ({ type: "text" as const, text }))
  const history = layers.history.length > 0 ? layers.history : undefined
  return {
    id: input.projection.fingerprint,
    model: input.model,
    system,
    messages: [
      ...(input.toolHistory ?? []),
      ...(history ? [Message.user(history)] : []),
      ...(layers.live ? [Message.user(layers.live)] : []),
      Message.user(input.prompt),
    ],
    tools: input.tools.map((t) => t.definition),
    toolChoice: ToolChoice.make(input.toolChoice ?? "auto"),
  }
}

/** Runs one real provider turn through LLMClient.stream. */
export function streamTurn(input: {
  readonly llm: LlmStreamer
  readonly request: LLMRequest.Input
  readonly onUsage?: (usage: Usage) => void
}): Effect.Effect<ProviderTurnResult, unknown> {
  return collectEvents(input.llm.stream(new LLMRequest(input.request)), input.onUsage)
}
