import { Schema } from "effect"
import { ContentBlockID, FinishReason, ProtocolID, ProviderMetadata, RouteID, ToolCallID } from "./ids"
import { ModelSchema } from "./options"
import { Message, ToolCallPart, ToolOutput, ToolResultPart, ToolResultValue, type ContentPart } from "./messages"
import { ProviderFailureClassification } from "./errors"
import { ToolPresentation } from "@opencode-ai/schema/tool-presentation"

/**
 * Token usage reported by an LLM provider.
 *
 * **Inclusive totals** (match AI SDK / OpenAI / LangChain convention — a
 * reader from any of those ecosystems sees the number they expect):
 *
 * - `inputTokens` — total prompt tokens, *including* cached reads/writes.
 * - `outputTokens` — total output tokens, *including* reasoning.
 * - `totalTokens` — provider-supplied total, or `inputTokens + outputTokens`.
 *
 * **Non-overlapping breakdown** (every field is independently meaningful;
 * consumers never have to subtract):
 *
 * - `nonCachedInputTokens` — the "fresh" portion of the prompt.
 * - `cacheReadInputTokens` — input tokens served from cache.
 * - `cacheWriteInputTokens` — input tokens written to cache.
 * - `reasoningTokens` — subset of `outputTokens` spent on hidden reasoning.
 *
 * **Invariant**: `nonCachedInputTokens + cacheReadInputTokens +
 * cacheWriteInputTokens = inputTokens`, and `reasoningTokens ≤ outputTokens`.
 * Each protocol mapper computes whichever side it doesn't get natively,
 * with `Math.max(0, …)` clamping for defense against provider bugs. Because
 * every breakdown field is stored independently, downstream consumers can
 * read whatever they need (cost-by-category, context-pressure, AI-SDK-style
 * inclusive total) without ever subtracting — eliminating the underflow
 * class of bug where a clamped difference would silently store the wrong
 * value.
 *
 * **Semantics by provider**:
 *
 * - OpenAI Chat / Responses / Gemini / Bedrock: provider reports inclusive
 *   `inputTokens` and an inclusive `outputTokens`; mapper subtracts to
 *   derive the breakdown.
 * - Anthropic: provider reports the breakdown natively (`input_tokens` is
 *   non-cached only); mapper sums to derive the inclusive `inputTokens`.
 *   Anthropic does *not* break extended-thinking out of `output_tokens`, so
 *   `reasoningTokens` is `undefined` and `outputTokens` carries the
 *   combined total — a documented limitation of the Anthropic API.
 *
 * `providerMetadata` always carries the provider's raw usage payload —
 * keyed by provider name (`{ openai: ... }`, `{ anthropic: ... }`, etc.)
 * — for fields we don't normalize and for billing-level audit trails.
 * Matches the same escape-hatch field on `LLMEvent`.
 */
export class Usage extends Schema.Class<Usage>("LLM.Usage")({
  inputTokens: Schema.optional(Schema.Number),
  outputTokens: Schema.optional(Schema.Number),
  nonCachedInputTokens: Schema.optional(Schema.Number),
  cacheReadInputTokens: Schema.optional(Schema.Number),
  cacheWriteInputTokens: Schema.optional(Schema.Number),
  reasoningTokens: Schema.optional(Schema.Number),
  totalTokens: Schema.optional(Schema.Number),
  providerMetadata: Schema.optional(ProviderMetadata),
}) {
  /**
   * Visible output tokens — `outputTokens` minus `reasoningTokens`, clamped
   * to zero. The one place subtraction happens in this contract; the clamp
   * means a provider reporting `reasoningTokens > outputTokens` produces a
   * harmless zero rather than a negative that crashes downstream schemas.
   */
  get visibleOutputTokens() {
    return Math.max(0, (this.outputTokens ?? 0) - (this.reasoningTokens ?? 0))
  }

  static from(input: UsageInput) {
    return input instanceof Usage ? input : new Usage(input)
  }
}

export type UsageInput = Usage | ConstructorParameters<typeof Usage>[0]

export const StepStart = Schema.Struct({
  type: Schema.tag("step-start"),
  index: Schema.Number,
}).annotate({ identifier: "LLM.Event.StepStart" })
export type StepStart = Schema.Schema.Type<typeof StepStart>

export const TextStart = Schema.Struct({
  type: Schema.tag("text-start"),
  id: ContentBlockID,
  providerMetadata: Schema.optional(ProviderMetadata),
}).annotate({ identifier: "LLM.Event.TextStart" })
export type TextStart = Schema.Schema.Type<typeof TextStart>

export const TextDelta = Schema.Struct({
  type: Schema.tag("text-delta"),
  id: ContentBlockID,
  text: Schema.String,
  providerMetadata: Schema.optional(ProviderMetadata),
}).annotate({ identifier: "LLM.Event.TextDelta" })
export type TextDelta = Schema.Schema.Type<typeof TextDelta>

export const TextEnd = Schema.Struct({
  type: Schema.tag("text-end"),
  id: ContentBlockID,
  providerMetadata: Schema.optional(ProviderMetadata),
}).annotate({ identifier: "LLM.Event.TextEnd" })
export type TextEnd = Schema.Schema.Type<typeof TextEnd>

export const ReasoningStart = Schema.Struct({
  type: Schema.tag("reasoning-start"),
  id: ContentBlockID,
  providerMetadata: Schema.optional(ProviderMetadata),
}).annotate({ identifier: "LLM.Event.ReasoningStart" })
export type ReasoningStart = Schema.Schema.Type<typeof ReasoningStart>

export const ReasoningDelta = Schema.Struct({
  type: Schema.tag("reasoning-delta"),
  id: ContentBlockID,
  text: Schema.String,
  providerMetadata: Schema.optional(ProviderMetadata),
}).annotate({ identifier: "LLM.Event.ReasoningDelta" })
export type ReasoningDelta = Schema.Schema.Type<typeof ReasoningDelta>

export const ReasoningEnd = Schema.Struct({
  type: Schema.tag("reasoning-end"),
  id: ContentBlockID,
  providerMetadata: Schema.optional(ProviderMetadata),
}).annotate({ identifier: "LLM.Event.ReasoningEnd" })
export type ReasoningEnd = Schema.Schema.Type<typeof ReasoningEnd>

export const ToolInputStart = Schema.Struct({
  type: Schema.tag("tool-input-start"),
  id: ToolCallID,
  name: Schema.String,
  providerMetadata: Schema.optional(ProviderMetadata),
}).annotate({ identifier: "LLM.Event.ToolInputStart" })
export type ToolInputStart = Schema.Schema.Type<typeof ToolInputStart>

export const ToolInputDelta = Schema.Struct({
  type: Schema.tag("tool-input-delta"),
  id: ToolCallID,
  name: Schema.String,
  text: Schema.String,
}).annotate({ identifier: "LLM.Event.ToolInputDelta" })
export type ToolInputDelta = Schema.Schema.Type<typeof ToolInputDelta>

export const ToolInputEnd = Schema.Struct({
  type: Schema.tag("tool-input-end"),
  id: ToolCallID,
  name: Schema.String,
  providerMetadata: Schema.optional(ProviderMetadata),
}).annotate({ identifier: "LLM.Event.ToolInputEnd" })
export type ToolInputEnd = Schema.Schema.Type<typeof ToolInputEnd>

export const ToolCall = Schema.Struct({
  type: Schema.tag("tool-call"),
  id: ToolCallID,
  name: Schema.String,
  input: Schema.Unknown,
  presentation: Schema.optional(ToolPresentation.Call),
  providerExecuted: Schema.optional(Schema.Boolean),
  providerMetadata: Schema.optional(ProviderMetadata),
}).annotate({ identifier: "LLM.Event.ToolCall" })
export type ToolCall = Schema.Schema.Type<typeof ToolCall>

export const ToolResult = Schema.Struct({
  type: Schema.tag("tool-result"),
  id: ToolCallID,
  name: Schema.String,
  result: ToolResultValue,
  output: Schema.optional(ToolOutput),
  presentation: Schema.optional(ToolPresentation.Result),
  providerExecuted: Schema.optional(Schema.Boolean),
  providerMetadata: Schema.optional(ProviderMetadata),
}).annotate({ identifier: "LLM.Event.ToolResult" })
export type ToolResult = Schema.Schema.Type<typeof ToolResult>

export const ToolError = Schema.Struct({
  type: Schema.tag("tool-error"),
  id: ToolCallID,
  name: Schema.String,
  message: Schema.String,
  error: Schema.optional(Schema.Defect()),
  providerMetadata: Schema.optional(ProviderMetadata),
}).annotate({ identifier: "LLM.Event.ToolError" })
export type ToolError = Schema.Schema.Type<typeof ToolError>

export const StepFinish = Schema.Struct({
  type: Schema.tag("step-finish"),
  index: Schema.Number,
  reason: FinishReason,
  usage: Schema.optional(Usage),
  providerMetadata: Schema.optional(ProviderMetadata),
}).annotate({ identifier: "LLM.Event.StepFinish" })
export type StepFinish = Schema.Schema.Type<typeof StepFinish>

export const Finish = Schema.Struct({
  type: Schema.tag("finish"),
  reason: FinishReason,
  usage: Schema.optional(Usage),
  providerMetadata: Schema.optional(ProviderMetadata),
}).annotate({ identifier: "LLM.Event.Finish" })
export type Finish = Schema.Schema.Type<typeof Finish>

export const ProviderErrorEvent = Schema.Struct({
  type: Schema.tag("provider-error"),
  message: Schema.String,
  classification: Schema.optional(ProviderFailureClassification),
  retryable: Schema.optional(Schema.Boolean),
  providerMetadata: Schema.optional(ProviderMetadata),
}).annotate({ identifier: "LLM.Event.ProviderError" })
export type ProviderErrorEvent = Schema.Schema.Type<typeof ProviderErrorEvent>

const llmEventTagged = Schema.Union([
  StepStart,
  TextStart,
  TextDelta,
  TextEnd,
  ReasoningStart,
  ReasoningDelta,
  ReasoningEnd,
  ToolInputStart,
  ToolInputDelta,
  ToolInputEnd,
  ToolCall,
  ToolResult,
  ToolError,
  StepFinish,
  Finish,
  ProviderErrorEvent,
]).pipe(Schema.toTaggedUnion("type"))

type WithID<Event extends { readonly id: unknown }, ID> = Omit<Event, "type" | "id"> & { readonly id: ID | string }
type WithUsage<Event extends { readonly usage?: Usage }> = Omit<Event, "type" | "usage"> & {
  readonly usage?: UsageInput
}

const contentBlockID = (value: ContentBlockID | string) => ContentBlockID.make(value)
const toolCallID = (value: ToolCallID | string) => ToolCallID.make(value)

/**
 * camelCase aliases for `LLMEvent.guards` (provided by `Schema.toTaggedUnion`).
 * Lets consumers write `events.filter(LLMEvent.is.toolCall)` instead of
 * `events.filter(LLMEvent.guards["tool-call"])`.
 */
export const LLMEvent = Object.assign(llmEventTagged, {
  stepStart: StepStart.make,
  textStart: (input: WithID<TextStart, ContentBlockID>) => TextStart.make({ ...input, id: contentBlockID(input.id) }),
  textDelta: (input: WithID<TextDelta, ContentBlockID>) => TextDelta.make({ ...input, id: contentBlockID(input.id) }),
  textEnd: (input: WithID<TextEnd, ContentBlockID>) => TextEnd.make({ ...input, id: contentBlockID(input.id) }),
  reasoningStart: (input: WithID<ReasoningStart, ContentBlockID>) =>
    ReasoningStart.make({ ...input, id: contentBlockID(input.id) }),
  reasoningDelta: (input: WithID<ReasoningDelta, ContentBlockID>) =>
    ReasoningDelta.make({ ...input, id: contentBlockID(input.id) }),
  reasoningEnd: (input: WithID<ReasoningEnd, ContentBlockID>) =>
    ReasoningEnd.make({ ...input, id: contentBlockID(input.id) }),
  toolInputStart: (input: WithID<ToolInputStart, ToolCallID>) =>
    ToolInputStart.make({ ...input, id: toolCallID(input.id) }),
  toolInputDelta: (input: WithID<ToolInputDelta, ToolCallID>) =>
    ToolInputDelta.make({ ...input, id: toolCallID(input.id) }),
  toolInputEnd: (input: WithID<ToolInputEnd, ToolCallID>) => ToolInputEnd.make({ ...input, id: toolCallID(input.id) }),
  toolCall: (input: WithID<ToolCall, ToolCallID>) => ToolCall.make({ ...input, id: toolCallID(input.id) }),
  toolResult: (input: WithID<ToolResult, ToolCallID>) =>
    ToolResult.make({
      ...input,
      id: toolCallID(input.id),
      output: input.output === undefined ? undefined : ToolOutput.make(input.output.structured, input.output.content),
    }),
  toolError: (input: WithID<ToolError, ToolCallID>) => ToolError.make({ ...input, id: toolCallID(input.id) }),
  stepFinish: (input: WithUsage<StepFinish>) =>
    StepFinish.make({
      ...input,
      usage: input.usage === undefined ? undefined : Usage.from(input.usage),
    }),
  finish: (input: WithUsage<Finish>) =>
    Finish.make({
      ...input,
      usage: input.usage === undefined ? undefined : Usage.from(input.usage),
    }),
  providerError: ProviderErrorEvent.make,
  is: {
    stepStart: llmEventTagged.guards["step-start"],
    textStart: llmEventTagged.guards["text-start"],
    textDelta: llmEventTagged.guards["text-delta"],
    textEnd: llmEventTagged.guards["text-end"],
    reasoningStart: llmEventTagged.guards["reasoning-start"],
    reasoningDelta: llmEventTagged.guards["reasoning-delta"],
    reasoningEnd: llmEventTagged.guards["reasoning-end"],
    toolInputStart: llmEventTagged.guards["tool-input-start"],
    toolInputDelta: llmEventTagged.guards["tool-input-delta"],
    toolInputEnd: llmEventTagged.guards["tool-input-end"],
    toolCall: llmEventTagged.guards["tool-call"],
    toolResult: llmEventTagged.guards["tool-result"],
    toolError: llmEventTagged.guards["tool-error"],
    stepFinish: llmEventTagged.guards["step-finish"],
    finish: llmEventTagged.guards.finish,
    providerError: llmEventTagged.guards["provider-error"],
  },
})
export type LLMEvent = Schema.Schema.Type<typeof llmEventTagged>

export class PreparedRequest extends Schema.Class<PreparedRequest>("LLM.PreparedRequest")({
  id: Schema.String,
  route: RouteID,
  protocol: ProtocolID,
  model: ModelSchema,
  body: Schema.Unknown,
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
}) {}

/**
 * A `PreparedRequest` whose `body` is typed as `Body`. Use with the generic
 * on `LLMClient.prepare<Body>(...)` when the caller knows which route their
 * request will resolve to and wants its native shape statically exposed
 * (debug UIs, request previews, plan rendering).
 *
 * The runtime body is identical — the route still emits `body: unknown` — so
 * this is a type-level assertion the caller makes about what they expect to
 * find. The prepare runtime does not validate the assertion.
 */
export type PreparedRequestOf<Body> = Omit<PreparedRequest, "body"> & {
  readonly body: Body
}

const responseText = (events: ReadonlyArray<LLMEvent>) =>
  events
    .filter(LLMEvent.is.textDelta)
    .map((event) => event.text)
    .join("")

const responseReasoning = (events: ReadonlyArray<LLMEvent>) =>
  events
    .filter(LLMEvent.is.reasoningDelta)
    .map((event) => event.text)
    .join("")

const responseUsage = (events: ReadonlyArray<LLMEvent>) =>
  events.reduce<Usage | undefined>(
    (usage, event) => ("usage" in event && event.usage !== undefined ? event.usage : usage),
    undefined,
  )

interface ContentAssembly {
  contentIndex: number
  text: string
  providerMetadata?: ProviderMetadata
}

interface ToolInputAssembly {
  name: string
  text: string
  providerMetadata?: ProviderMetadata
}

interface ResponseState {
  events: LLMEvent[]
  message: Message
  usage?: Usage
  finishReason?: FinishReason
  textParts: Record<string, ContentAssembly>
  reasoningParts: Record<string, ContentAssembly>
  toolInputs: Record<string, ToolInputAssembly>
}

const emptyResponseState = (): ResponseState => ({
  events: [],
  message: Message.assistant([]),
  textParts: {},
  reasoningParts: {},
  toolInputs: {},
})

const mutableContent = (state: ResponseState): ContentPart[] =>
  state.message.content as unknown as ContentPart[]

const appendEvent = (state: ResponseState, event: LLMEvent): ResponseState => {
  state.events.push(event)
  if (LLMEvent.is.finish(event)) {
    if (event.usage) state.usage = event.usage
    if (!state.finishReason) state.finishReason = event.reason
  } else if (LLMEvent.is.providerError(event)) {
    if (!state.finishReason) state.finishReason = "error"
  } else if ("usage" in event && event.usage !== undefined) {
    state.usage = event.usage
  }
  return state
}

const textContent = (text: string, providerMetadata: ProviderMetadata | undefined): ContentPart =>
  providerMetadata === undefined ? { type: "text", text } : { type: "text", text, providerMetadata }

const reasoningContent = (text: string, providerMetadata: ProviderMetadata | undefined): ContentPart =>
  providerMetadata === undefined ? { type: "reasoning", text } : { type: "reasoning", text, providerMetadata }

const appendContent = (state: ResponseState, part: ContentPart): ResponseState => {
  mutableContent(state).push(part)
  return state
}

const replaceContent = (state: ResponseState, index: number, part: ContentPart): ResponseState => {
  mutableContent(state)[index] = part
  return state
}

const ensureText = (state: ResponseState, id: string, providerMetadata?: ProviderMetadata): ResponseState => {
  if (state.textParts[id]) return state
  const contentIndex = state.message.content.length
  appendContent(state, textContent("", providerMetadata))
  state.textParts[id] = { contentIndex, text: "", providerMetadata }
  return state
}

const reduceTextDelta = (state: ResponseState, event: TextDelta): ResponseState => {
  const started = ensureText(state, event.id, event.providerMetadata)
  const current = started.textParts[event.id]
  if (!current) return started
  current.text += event.text
  current.providerMetadata = event.providerMetadata ?? current.providerMetadata
  replaceContent(started, current.contentIndex, textContent(current.text, current.providerMetadata))
  return started
}

const reduceTextEnd = (state: ResponseState, event: TextEnd): ResponseState => {
  const current = state.textParts[event.id]
  if (!current) return state
  current.providerMetadata = event.providerMetadata ?? current.providerMetadata
  replaceContent(state, current.contentIndex, textContent(current.text, current.providerMetadata))
  return state
}

const ensureReasoning = (state: ResponseState, id: string, providerMetadata?: ProviderMetadata): ResponseState => {
  if (state.reasoningParts[id]) return state
  const contentIndex = state.message.content.length
  appendContent(state, reasoningContent("", providerMetadata))
  state.reasoningParts[id] = { contentIndex, text: "", providerMetadata }
  return state
}

const reduceReasoningDelta = (state: ResponseState, event: ReasoningDelta): ResponseState => {
  const started = ensureReasoning(state, event.id, event.providerMetadata)
  const current = started.reasoningParts[event.id]
  if (!current) return started
  current.text += event.text
  current.providerMetadata = event.providerMetadata ?? current.providerMetadata
  replaceContent(started, current.contentIndex, reasoningContent(current.text, current.providerMetadata))
  return started
}

const reduceReasoningEnd = (state: ResponseState, event: ReasoningEnd): ResponseState => {
  const current = state.reasoningParts[event.id]
  if (!current) return state
  current.providerMetadata = event.providerMetadata ?? current.providerMetadata
  replaceContent(state, current.contentIndex, reasoningContent(current.text, current.providerMetadata))
  return state
}

const reduceToolInputStart = (state: ResponseState, event: ToolInputStart): ResponseState => {
  state.toolInputs[event.id] = { name: event.name, text: "", providerMetadata: event.providerMetadata }
  return state
}

const reduceToolInputDelta = (state: ResponseState, event: ToolInputDelta): ResponseState => {
  let current = state.toolInputs[event.id]
  if (!current) {
    current = { name: event.name, text: "" }
    state.toolInputs[event.id] = current
  }
  current.text += event.text
  return state
}

const reduceToolInputEnd = (state: ResponseState, event: ToolInputEnd): ResponseState => {
  let current = state.toolInputs[event.id]
  if (!current) {
    current = { name: event.name, text: "" }
    state.toolInputs[event.id] = current
  }
  current.name = event.name
  current.providerMetadata = event.providerMetadata ?? current.providerMetadata
  return state
}

const toolCallContent = (event: ToolCall): ContentPart =>
  ToolCallPart.make({
    id: event.id,
    name: event.name,
    input: event.input,
    ...(event.providerExecuted === undefined ? {} : { providerExecuted: event.providerExecuted }),
    ...(event.providerMetadata === undefined ? {} : { providerMetadata: event.providerMetadata }),
  })

const toolResultContent = (event: ToolResult): ContentPart =>
  ToolResultPart.make({
    id: event.id,
    name: event.name,
    result: event.result,
    ...(event.providerExecuted === undefined ? {} : { providerExecuted: event.providerExecuted }),
    ...(event.providerMetadata === undefined ? {} : { providerMetadata: event.providerMetadata }),
  })

const reduceToolCall = (state: ResponseState, event: ToolCall): ResponseState => {
  delete state.toolInputs[event.id]
  appendContent(state, toolCallContent(event))
  return state
}

const reduceResponseState = (state: ResponseState, event: LLMEvent): ResponseState => {
  appendEvent(state, event)
  switch (event.type) {
    case "text-start":
      return ensureText(state, event.id, event.providerMetadata)
    case "text-delta":
      return reduceTextDelta(state, event)
    case "text-end":
      return reduceTextEnd(state, event)
    case "reasoning-start":
      return ensureReasoning(state, event.id, event.providerMetadata)
    case "reasoning-delta":
      return reduceReasoningDelta(state, event)
    case "reasoning-end":
      return reduceReasoningEnd(state, event)
    case "tool-input-start":
      return reduceToolInputStart(state, event)
    case "tool-input-delta":
      return reduceToolInputDelta(state, event)
    case "tool-input-end":
      return reduceToolInputEnd(state, event)
    case "tool-call":
      return reduceToolCall(state, event)
    case "tool-result":
      return appendContent(state, toolResultContent(event))
    default:
      return state
  }
}

export class LLMResponse extends Schema.Class<LLMResponse>("LLM.Response")({
  message: Message,
  events: Schema.Array(LLMEvent),
  usage: Schema.optional(Usage),
  finishReason: FinishReason,
}) {
  /** Concatenated assistant text assembled from streamed `text-delta` events. */
  get text() {
    return responseText(this.events)
  }

  /** Concatenated reasoning text assembled from streamed `reasoning-delta` events. */
  get reasoning() {
    return responseReasoning(this.events)
  }

  /** Completed tool calls emitted by the provider. */
  get toolCalls() {
    return this.events.filter(LLMEvent.is.toolCall)
  }
}

export namespace LLMResponse {
  export type State = ResponseState
  export type Output = LLMResponse | { readonly events: ReadonlyArray<LLMEvent>; readonly usage?: Usage }

  /** Initial reducer state for assembling one provider attempt. */
  export const empty = emptyResponseState

  /** Purely fold one provider-neutral event into the attempt assembly state. */
  export const reduce = reduceResponseState

  /** Return a completed response only after a terminal finish or provider error. */
  export const complete = (state: State): LLMResponse | undefined => {
    if (state.finishReason === undefined) return undefined
    return new LLMResponse({
      message: Message.assistant([...state.message.content]),
      events: [...state.events],
      usage: state.usage,
      finishReason: state.finishReason,
    })
  }

  /** Convenience reducer for callers that already have a collected event list. */
  export const fromEvents = (events: ReadonlyArray<LLMEvent>) => complete(events.reduce(reduce, empty()))

  /** Concatenate assistant text from a response or collected event list. */
  export const text = (response: Output) => responseText(response.events)

  /** Return response usage, falling back to the latest usage-bearing event. */
  export const usage = (response: Output) => response.usage ?? responseUsage(response.events)

  /** Return completed tool calls from a response or collected event list. */
  export const toolCalls = (response: Output) => response.events.filter(LLMEvent.is.toolCall)

  /** Concatenate reasoning text from a response or collected event list. */
  export const reasoning = (response: Output) => responseReasoning(response.events)
}
