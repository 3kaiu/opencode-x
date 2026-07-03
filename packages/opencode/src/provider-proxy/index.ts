import type * as NativeTypes from "./native"
import { Stream } from "effect"

const Native = require("./index.node") as {
  streamSse: (
    options: NativeTypes.SseStreamOptions,
    onEvent: (err: unknown, event: NativeTypes.SseEvent) => void,
    onError: (err: unknown, msg: string) => void,
    onDone: (err: unknown) => void,
  ) => Promise<void>
}

export type SseEvent = NativeTypes.SseEvent
export type SseStreamOptions = NativeTypes.SseStreamOptions

export function streamSse(options: SseStreamOptions): Stream.Stream<SseEvent, Error> {
  return Stream.fromReadableStream<SseEvent, Error>({
    evaluate: () => {
      let controller: ReadableStreamDefaultController<SseEvent> | null = null

      const promise = Native.streamSse(
        options,
        (_err, event) => controller?.enqueue(event),
        (_err, msg) => controller?.error(new Error(msg)),
        () => controller?.close(),
      )

      promise.catch((error: Error) => controller?.error(error))

      return new ReadableStream<SseEvent>({
        start(c) {
          controller = c
        },
      })
    },
    onError: (error) => (error instanceof Error ? error : new Error(String(error))),
  })
}
