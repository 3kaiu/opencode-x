import { Effect, Stream } from "effect"
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
    return stream.pipe(
      Stream.tap((event) =>
        Effect.gen(function* () {
          if (LLMEvent.is.textDelta(event)) {
            if (state.firstTokenAt === undefined) {
              state.firstTokenAt = Date.now()
              observability.record("timer", "llm.first-token", requestLabels(request), state.firstTokenAt - state.startedAt)
            }
          } else if (LLMEvent.is.finish(event)) {
            const usage = event.usage
            if (usage !== undefined) {
              if (usage.inputTokens !== undefined) {
                observability.record("counter", "llm.tokens.input", requestLabels(request), usage.inputTokens)
              }
              if (usage.outputTokens !== undefined) {
                observability.record("counter", "llm.tokens.output", requestLabels(request), usage.outputTokens)
              }
            }
            observability.record("timer", "llm.duration", requestLabels(request), Date.now() - state.startedAt)
          } else if (LLMEvent.is.providerError(event)) {
            observability.record("counter", "llm.errors", requestLabels(request), 1)
          }
        }),
      ),
    )
  }

/**
 * Wraps a provider stream in a tracing span (one span per `llm.stream` turn).
 * The span attributes summarize the provider, route, and model so the call
 * tree stays readable in the trace (§6.2).
 */
export const observeStreamSpan = <A, E, R>(
  request: LLMRequest,
  stream: Stream.Stream<A, E, R>,
): Stream.Stream<A, E, R> => stream.pipe(Stream.withSpan("llm.stream", {
  attributes: {
    provider: request.model.provider,
    route: request.model.route.id,
    model: request.model.id,
  },
}))
