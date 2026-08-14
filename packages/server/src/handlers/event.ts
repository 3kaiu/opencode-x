import { Event } from "@opencode-ai/core/event"
import { EventManifest } from "@opencode-ai/schema/event-manifest"
import { OpenCodeEvent } from "@opencode-ai/protocol/groups/event"
import { Effect, Schema, Stream } from "effect"
import { HttpServerResponse } from "effect/unstable/http"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import * as Sse from "effect/unstable/encoding/Sse"
import { Api } from "../api"

const subscriberCapacity = 256

// The SDK-facing event surface is ServerDefinitions. The underlying bus carries
// additional live events (e.g. V1-only `message.part.delta`/`session.diff`/
// `session.error`) that are not members of the current manifest; encoding them
// would throw and terminate the stream. Filter to the declared surface first.
const serverEventTypes = new Set<string>(EventManifest.ServerDefinitions.map((definition) => definition.type))

function isServerEvent(event: Event.Payload) {
  return serverEventTypes.has(event.type)
}

const encodeEvent = Schema.encodeUnknownSync(OpenCodeEvent)

function eventData(data: unknown): Sse.Event {
  return {
    _tag: "Event",
    event: "message",
    id: undefined,
    data: JSON.stringify(encodeEvent(data)),
  }
}

export const EventHandler = HttpApiBuilder.group(Api, "server.event", (handlers) =>
  Effect.gen(function* () {
    const events = yield* Event.Service
    return handlers.handleRaw("event.subscribe", () =>
      Effect.gen(function* () {
        const connected = {
          id: Event.ID.create(),
          type: "server.connected",
          data: {},
        }
        const output = Stream.unwrap(
          Effect.gen(function* () {
            // Acquiring the bounded stream installs its listener before readiness is observable.
            // Filter at the queue boundary so non-server events never occupy subscriber capacity.
            const live = yield* Event.allBounded(events, subscriberCapacity, isServerEvent)
            return Stream.make(connected).pipe(Stream.concat(live))
          }),
        ).pipe(Stream.map(eventData), Stream.pipeThroughChannel(Sse.encode()))
        const heartbeat = Stream.tick("15 seconds").pipe(Stream.map(() => ": heartbeat\n\n"))
        return HttpServerResponse.stream(
          output.pipe(Stream.merge(heartbeat, { haltStrategy: "left" }), Stream.encodeText),
          {
            contentType: "text/event-stream",
            headers: {
              "Cache-Control": "no-cache, no-transform",
              "X-Accel-Buffering": "no",
              "X-Content-Type-Options": "nosniff",
            },
          },
        )
      }),
    )
  }),
)
