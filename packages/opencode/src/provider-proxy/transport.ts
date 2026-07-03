import { Effect, Stream } from "effect"
import type { Transport, TransportPrepareInput, TransportRuntime } from "@opencode-ai/llm/route/transport"
import type { HttpPrepared } from "@opencode-ai/llm/route/transport/http"
import { jsonRequestParts } from "@opencode-ai/llm/route/transport/http"
import * as ProviderShared from "@opencode-ai/llm/protocols/shared"
import type { LLMError } from "@opencode-ai/llm"

import type * as NativeTypes from "./native"

const Native = require("./index.node") as {
  streamSse: (
    options: NativeTypes.SseStreamOptions,
    onEvent: (err: unknown, event: NativeTypes.SseEvent) => void,
    onError: (err: unknown, msg: string) => void,
    onDone: (err: unknown) => void,
  ) => Promise<void>
}

export function rustTransport<Body>(): Transport<Body, HttpPrepared<string>, string> {
  return {
    id: "http-json/rust",
    prepare: (input: TransportPrepareInput<Body>) =>
      jsonRequestParts(input).pipe(
        Effect.map((parts) => {
          const request = ProviderShared.jsonPost({ url: parts.url, body: parts.bodyText, headers: parts.headers })
          const framing = { id: "sse" as const, frame: (s: Stream.Stream<Uint8Array, LLMError>) => s.pipe(Stream.decodeText()) }
          return { request, framing }
        }),
      ),
    frames: (prepared, request, _runtime) => {
      const label = `${request.model.provider}/${request.model.route.id}`
      return Stream.fromReadableStream<string, LLMError>({
        evaluate: () => {
          let controller: ReadableStreamDefaultController<string> | null = null
          const promise = Native.streamSse(
            {
              url: prepared.request.url,
              method: prepared.request.method,
              headers: Object.entries(prepared.request.headers)
                .filter(([_, v]) => typeof v === "string") as [string, string][],
              body: prepared.request.body as unknown as string,
            },
            (_err, event) => {
              if (event.data && event.data !== "[DONE]") controller?.enqueue(event.data)
            },
            () => {},
            () => controller?.close(),
          )
          promise.catch(() => controller?.close())
          return new ReadableStream<string>({
            start(c) { controller = c },
          })
        },
        onError: () => ProviderShared.eventError(label, "Rust stream failed") as unknown as LLMError,
      })
    },
  }
}