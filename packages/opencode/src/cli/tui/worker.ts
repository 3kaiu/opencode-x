import { Server } from "@/server/server"
import { InstanceRuntime } from "@/project/instance-runtime"
import { Rpc } from "@/util/rpc"
import { upgrade } from "@/cli/upgrade"
import { Config } from "@/config/config"
import { GlobalBus } from "@/bus/global"
import { ServerAuth } from "@/server/auth"
import { writeHeapSnapshot } from "node:v8"
import { Heap } from "@/cli/heap"
import { AppRuntime } from "@/effect/app-runtime"
import { Effect } from "effect"
import { disposeAllInstancesAndEmitGlobalDisposed } from "@/server/global-lifecycle"

// Prewarm the server app so the first TUI request does not pay the full
// instance-runtime startup (~2.4s) synchronously. The lazy `Server.Default`
// only builds the handler shell; the actual instance startup happens on the
// first fetch, so fire a probe request in the background while the TUI renders.
setTimeout(() => {
  void (async () => {
    const directory = process.cwd()
    await Promise.resolve(
      Server.Default().app.fetch(
        new Request(`http://opencode.internal/path?directory=${encodeURIComponent(directory)}`),
      ),
    )
  })().catch(() => {})
}, 0)

Heap.start()

const onUnhandledRejection = (_error: unknown) => {}

const onUncaughtException = (_error: Error) => {}

process.on("unhandledRejection", onUnhandledRejection)
process.on("uncaughtException", onUncaughtException)

// Subscribe to global events and forward them via RPC
GlobalBus.on("event", (event) => {
  Rpc.emit("global.event", event)
})

let server: Awaited<ReturnType<typeof Server.listen>> | undefined

const streamRelays = new Map<number, ReadableStreamDefaultReader<Uint8Array>>()

async function relayStream(streamID: number, body: ReadableStream<Uint8Array>) {
  const reader = body.getReader()
  streamRelays.set(streamID, reader)
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      Rpc.emit("fetch.stream", { id: streamID, chunk: Array.from(value) })
    }
    Rpc.emit("fetch.stream", { id: streamID, end: true })
  } catch (error) {
    if (!streamRelays.has(streamID)) return
    Rpc.emit("fetch.stream", {
      id: streamID,
      error: error instanceof Error ? error.message : String(error),
    })
  } finally {
    streamRelays.delete(streamID)
  }
}

export const rpc = {
  async fetch(input: {
    url: string
    method: string
    headers: Record<string, string>
    body?: string
    streamID?: number
  }) {
    const headers = { ...input.headers }
    const auth = ServerAuth.header()
    if (auth && !headers["authorization"] && !headers["Authorization"]) {
      headers["Authorization"] = auth
    }
    const request = new Request(input.url, {
      method: input.method,
      headers,
      body: input.body,
    })
    const response = await Server.Default().app.fetch(request)
    const responseHeaders = Object.fromEntries(response.headers.entries())
    // Stream the response body through RPC events so SSE (an infinite stream) and
    // large bodies work over the worker boundary; request/text() cannot await an
    // SSE response to completion. `streamID` opts in; non-streaming responses
    // keep returning the buffered body.
    if (input.streamID === undefined || !response.body) {
      const body = await response.text()
      return { status: response.status, headers: responseHeaders, body }
    }
    void relayStream(input.streamID, response.body)
    return { status: response.status, headers: responseHeaders, stream: true }
  },
  snapshot() {
    const result = writeHeapSnapshot("server.heapsnapshot")
    return result
  },
  async fetchAbort(input: { streamID: number }) {
    const reader = streamRelays.get(input.streamID)
    if (!reader) return
    await reader.cancel().catch(() => {})
  },
  async server(input: { port: number; hostname: string; cors?: string[] }) {
    if (server) await server.stop(true)
    server = await Server.listen(input)
    return { url: server.url.toString() }
  },
  async checkUpgrade(input: { directory: string }) {
    await InstanceRuntime.load({ directory: input.directory })
    await upgrade().catch(() => {})
  },
  async reload() {
    await AppRuntime.runPromise(
      Effect.gen(function* () {
        const cfg = yield* Config.Service
        yield* cfg.invalidate()
        yield* disposeAllInstancesAndEmitGlobalDisposed({ swallowErrors: true })
      }),
    )
  },
  async shutdown() {
    await InstanceRuntime.disposeAllInstances()
    if (server) await server.stop(true)
    process.off("unhandledRejection", onUnhandledRejection)
    process.off("uncaughtException", onUncaughtException)
  },
}

Rpc.listen(rpc)
