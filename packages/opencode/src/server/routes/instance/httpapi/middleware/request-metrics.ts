import { Clock, Effect, Option } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { Observability } from "@opencode-ai/observability"

// Per-request span: records http.request duration and status counters with a
// path label bucketed to the first segment to avoid high cardinality. Wired as
// a global router middleware in createRoutes (batch D).
const ignored = new Set(["OPTIONS"])

function bucket(url: string): string {
  const pathname = url.split("?")[0]
  const segments = pathname.split("/").filter(Boolean)
  return segments.length > 0 ? `/${segments[0]}` : "/"
}

export const bucketPath = bucket

export const requestMetricsLayer = HttpRouter.middleware<{ handles: unknown }>()(
  Effect.gen(function* () {
    const observability = Option.getOrUndefined(yield* Effect.serviceOption(Observability))
    return (effect) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        if (ignored.has(request.method)) return yield* effect

        const started = yield* Clock.currentTimeMillis
        const response = yield* effect
        const elapsed = (yield* Clock.currentTimeMillis) - started
        const labels = {
          method: request.method,
          path: bucket(request.url),
          status: String(response.status),
        }
        observability?.record("timer", "http.request.duration", labels, elapsed)
        observability?.record("counter", "http.request.count", labels, 1)
        return response
      })
  }),
).layer