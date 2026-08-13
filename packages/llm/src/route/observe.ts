import { Context, Effect, Exit, Option, Stream, Tracer } from "effect"
import { Observability, type ObservabilityInterface } from "@opencode-ai/observability"
import { LLMEvent, type LLMRequest } from "../schema"

interface ObserveState {
  firstTokenAt?: number
  startedAt: number
}

const requestLabels = (request: LLMRequest) => ({
  provider: request.model.provider,
  model: request.model.id,
})

/**
 * Taps a provider stream to record AI metrics (§6.3): first-token latency,
 * token usage on `finish`, total duration, and provider errors.
 *
 * Recording goes through the optional `Observability` service. When no
 * observability layer is provided every tap becomes a no-op, so the stream
 * runs with zero observer cost (§6.4). Tracing spans are added separately by
 * `observeStreamSpan` around the whole provider turn.
 */
export const observeStream =
  <E, R>(request: LLMRequest, observability?: ObservabilityInterface) =>
  (stream: Stream.Stream<LLMEvent, E, R>): Stream.Stream<LLMEvent, E, R> => {
    const state: ObserveState = { startedAt: Date.now() }
    if (observability === undefined) return stream
    const labels = requestLabels(request)
    return stream.pipe(
      Stream.tap((event) =>
        Effect.gen(function* () {
          if (LLMEvent.is.textDelta(event)) {
            if (state.firstTokenAt === undefined) {
              state.firstTokenAt = Date.now()
              observability.record("timer", "llm.first-token", labels, state.firstTokenAt - state.startedAt)
            }
          } else if (LLMEvent.is.finish(event)) {
            const usage = event.usage
            if (usage !== undefined) {
              if (usage.inputTokens !== undefined) {
                observability.record("counter", "llm.tokens.input", labels, usage.inputTokens)
              }
              if (usage.outputTokens !== undefined) {
                observability.record("counter", "llm.tokens.output", labels, usage.outputTokens)
              }
              const total = (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0)
              if (total > 0) {
                observability.record("counter", "llm.tokens.total", labels, total)
              }
            }
            if (state.firstTokenAt !== undefined) {
              observability.record("timer", "llm.streaming", labels, Date.now() - state.firstTokenAt)
            }
            observability.record("timer", "llm.duration", labels, Date.now() - state.startedAt)
          } else if (LLMEvent.is.providerError(event)) {
            observability.record("counter", "llm.errors", labels, 1)
          }
        }),
      ),
    )
  }

/**
 * Wraps a provider stream in a tracing span (one span per `llm.stream` turn)
 * with sub-stage child spans (§6.2) that partition the turn timeline:
 *
 * - `llm.first-token` — started with the stream, ended on the first text
 *   delta, so its duration is the time-to-first-token.
 * - `llm.streaming` — started on the first text delta, ended on the terminal
 *   event, so its duration is the streaming phase.
 * - `llm.completion` — started with the stream, ended on the terminal
 *   `finish` event (success) or `provider-error` event (failure), so its
 *   duration is the whole provider turn latency.
 *
 * The spans share the parent traceId and record parentSpanId, so trace files
 * reconstruct the full call tree. Sub-stages are skipped when no parent span
 * is active or the stream carries no LLM events.
 */
export const observeStreamSpan = <A extends LLMEvent, E, R>(
  request: LLMRequest,
  stream: Stream.Stream<A, E, R>,
): Stream.Stream<A, E, R> => {
  const attributes = {
    provider: request.model.provider,
    route: request.model.route.id,
    model: request.model.id,
  }
  const inner = Stream.unwrap(
    Effect.gen(function* () {
      const parent = yield* parentSpan
      if (Option.isNone(parent) || parent.value._tag !== "Span") return stream
      const stages: StageState = {
        parent: parent.value,
        attributes,
        firstToken: yield* stageSpan(parent.value, "llm.first-token", attributes),
        completion: yield* stageSpan(parent.value, "llm.completion", attributes),
      }
      return stream.pipe(
        Stream.tap((event) => stepStages(stages, event)),
        Stream.onExit((_exit) => closeStages(stages)),
      )
    }),
  )
  return Stream.withSpan(inner, "llm.stream", { attributes })
}

interface StageState {
  readonly parent: Tracer.Span
  readonly attributes: Record<string, unknown>
  firstToken?: Tracer.Span
  stream?: Tracer.Span
  completion?: Tracer.Span
}

const nowNs = () => BigInt(Math.floor(performance.now() * 1e6))

const endStage = (stage: Tracer.Span | undefined, exit: Exit.Exit<unknown, unknown>) => {
  if (stage === undefined) return
  stage.end(nowNs(), exit)
}

const parentSpan = Effect.gen(function* () {
  return Option.some(yield* Tracer.ParentSpan)
}).pipe(Effect.catch(() => Effect.succeed(Option.none<Tracer.Span>())))

const stageSpan = (parent: Tracer.Span, name: string, attributes: Record<string, unknown>) =>
  Effect.gen(function* () {
    const tracer = yield* Effect.tracer
    const span = tracer.span({
      name,
      parent: Option.some(parent),
      annotations: Context.empty(),
      links: [],
      startTime: nowNs(),
      kind: "internal",
      root: false,
      sampled: parent.sampled,
    })
    for (const [key, value] of Object.entries(attributes)) span.attribute(key, value)
    return span
  })

const stepStages = (stages: StageState, event: LLMEvent) =>
  Effect.gen(function* () {
    if (LLMEvent.is.textDelta(event)) {
      if (stages.firstToken !== undefined) {
        endStage(stages.firstToken, Exit.succeed(undefined))
        stages.firstToken = undefined
        stages.stream = yield* stageSpan(stages.parent, "llm.streaming", stages.attributes)
      }
    } else if (LLMEvent.is.finish(event)) {
      if (stages.completion !== undefined) {
        stages.completion.attribute("tokensInput", event.usage?.inputTokens ?? 0)
        stages.completion.attribute("tokensOutput", event.usage?.outputTokens ?? 0)
        endStage(stages.completion, Exit.succeed(undefined))
        stages.completion = undefined
      }
      endStage(stages.stream, Exit.succeed(undefined))
      stages.stream = undefined
    } else if (LLMEvent.is.providerError(event)) {
      endStage(stages.completion, Exit.fail(event.message))
      stages.completion = undefined
      endStage(stages.stream, Exit.fail(event.message))
      stages.stream = undefined
    }
  })

const closeStages = (stages: StageState) =>
  Effect.sync(() => {
    endStage(stages.firstToken, Exit.fail("stream ended before completion"))
    stages.firstToken = undefined
    endStage(stages.stream, Exit.fail("stream ended before completion"))
    stages.stream = undefined
    endStage(stages.completion, Exit.fail("stream ended before completion"))
    stages.completion = undefined
  })
