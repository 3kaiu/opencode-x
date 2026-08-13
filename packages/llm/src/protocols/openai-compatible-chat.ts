import { Stream } from "effect"
import { Route, type RouteRoutedModelInput } from "../route/client"
import { Endpoint } from "../route/endpoint"
import { Framing } from "../route/framing"
import * as OpenAIChat from "./openai-chat"

const ADAPTER = "openai-compatible-chat"

export type OpenAICompatibleChatModelInput = RouteRoutedModelInput

/**
 * OpenAI-compatible proxies occasionally leak non-Chat frames over a
 * `/chat/completions` stream: a trailing cost notification
 * (`{"choices":[],"cost":"0"}`) or a semantic Responses-API event
 * (`response.completed`, `response.output_text.delta`) passed through from a
 * Responses backend. `OpenAIChat.protocol` rejects frames without `choices`, so
 * one leaked event aborts the whole turn. Drop frames that are neither a Chat
 * chunk nor a top-level error before protocol decoding; real errors still
 * surface and `[DONE]`/empty keep-alives are already removed by `Framing.sse`.
 */
const tolerantFraming: Framing<string> = {
  id: "sse-tolerant",
  frame: (bytes) =>
    Framing.sse.frame(bytes).pipe(
      Stream.filter((frame) => {
        // Fast path: a top-level `choices` or `error` key always appears as the
        // `"choices"`/`"error"` substring, so legit chat chunks and real errors
        // pass without a JSON parse. Remaining frames fall back to the parse to
        // drop non-Chat events before protocol decoding.
        if (frame.includes('"choices"') || frame.includes('"error"')) return true
        let parsed: unknown
        try {
          parsed = JSON.parse(frame)
        } catch {
          return true
        }
        if (parsed === null || typeof parsed !== "object") return true
        if ("choices" in parsed) return true
        if ("error" in parsed) return true
        return false
      }),
    ),
}

/**
 * Route for non-OpenAI providers that expose an OpenAI Chat-compatible
 * `/chat/completions` endpoint. Reuses `OpenAIChat.protocol` end-to-end and
 * overrides only the route id so providers can be resolved per-family without
 * colliding with native OpenAI. Provider helpers configure the route endpoint
 * before model selection.
 */
export const route = Route.make({
  id: ADAPTER,
  protocol: OpenAIChat.protocol,
  endpoint: Endpoint.path("/chat/completions"),
  framing: tolerantFraming,
})

export * as OpenAICompatibleChat from "./openai-compatible-chat"
