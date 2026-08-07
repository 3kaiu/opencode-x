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
import { writeFileSync, appendFileSync } from "node:fs"

const workerLogEnabled = process.env.OPENCODE_DEBUG_LOG === "1"
let workerLogInitialized = false

function workerLog(...args: unknown[]) {
  if (!workerLogEnabled) return
  if (!workerLogInitialized) {
    workerLogInitialized = true
    try {
      writeFileSync("/tmp/opencode-worker-debug.log", "")
    } catch {
      // ignore
    }
  }
  const line =
    `+${Date.now() - workerBootTime}ms ` +
    args.map((a) => (typeof a === "string" ? a : safeString(a))).join(" ") +
    "\n"
  try {
    appendFileSync("/tmp/opencode-worker-debug.log", line)
  } catch {
    // never let logging break the worker
  }
}

function safeString(value: unknown) {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

const workerBootTime = Date.now()

function workerMark(label: string) {
  workerLog("[mark]", `+${Date.now() - workerBootTime}ms`, label)
}

workerMark("worker boot")

// Prewarm the server app so the first TUI request does not pay the full
// instance-runtime startup (~2.4s) synchronously. The lazy `Server.Default`
// only builds the handler shell; the actual instance startup happens on the
// first fetch, so fire a probe request in the background while the TUI renders.
setTimeout(() => {
  workerMark("Server.Default prewarm start")
  void (async () => {
    const directory = process.cwd()
    // Event-loop probe: if the layer graph build blocks the main thread
    // synchronously, these 100ms ticks pause and reveal the stall.
    let ticks = 0
    const probe = setInterval(() => {
      ticks += 1
      workerLog("[worker:loop]", "alive", ticks)
    }, 100)
    const t0 = Date.now()
    const response = await Promise.resolve(
      Server.Default().app.fetch(
        new Request(`http://opencode.internal/path?directory=${encodeURIComponent(directory)}`),
      ),
    )
    clearInterval(probe)
    workerLog(
      "[mark]",
      `+${Date.now() - workerBootTime}ms`,
      "Server.Default prewarm done",
      response.status,
      `${Date.now() - t0}ms`,
      "ticks:",
      ticks,
    )
  })().catch((error: unknown) => {
    workerLog(
      "[mark]",
      `+${Date.now() - workerBootTime}ms`,
      "Server.Default prewarm failed",
      error instanceof Error ? error.message : String(error),
    )
  })
}, 0)

// Sample worker process memory every 2s.
if (workerLogEnabled) {
  setInterval(() => {
    const m = process.memoryUsage()
    workerLog(
      "[worker:mem]",
      `rss=${Math.round(m.rss / 1024 / 1024)}MB`,
      `heap=${Math.round(m.heapUsed / 1024 / 1024)}MB`,
      `heapTotal=${Math.round(m.heapTotal / 1024 / 1024)}MB`,
    )
  }, 2000)
}

Heap.start()

const onUnhandledRejection = (_error: unknown) => {}

const onUncaughtException = (_error: Error) => {}

process.on("unhandledRejection", onUnhandledRejection)
process.on("uncaughtException", onUncaughtException)

// Subscribe to global events and forward them via RPC
GlobalBus.on("event", (event) => {
  workerLog("[worker:global.event]", event.payload.type)
  Rpc.emit("global.event", event)
})

let server: Awaited<ReturnType<typeof Server.listen>> | undefined
let serverDefaultReady = false

const streamRelays = new Map<number, ReadableStreamDefaultReader<Uint8Array>>()

async function relayStream(streamID: number, body: ReadableStream<Uint8Array>) {
  const reader = body.getReader()
  streamRelays.set(streamID, reader)
  let bytes = 0
  let chunkCount = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.length
      if (chunkCount < 2) {
        workerLog("[worker:relay:chunk]", streamID, Buffer.from(value).toString().slice(0, 300))
      }
      chunkCount += 1
      Rpc.emit("fetch.stream", { id: streamID, chunk: Array.from(value) })
    }
    workerLog("[worker:relay:end]", streamID, "bytes:", bytes)
    Rpc.emit("fetch.stream", { id: streamID, end: true })
  } catch (error) {
    if (!streamRelays.has(streamID)) return
    workerLog("[worker:relay:error]", streamID, error instanceof Error ? error.message : String(error))
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
    const start = Date.now()
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
    if (!serverDefaultReady) {
      serverDefaultReady = true
      workerMark("Server.Default() first fetch")
    }
    const response = await Server.Default().app.fetch(request)
    const fetchMs = Date.now() - start
    if (fetchMs > 30) workerLog("[worker:fetch:slow]", input.url, "->", response.status, `${fetchMs}ms`)
    const responseHeaders = Object.fromEntries(response.headers.entries())
    // Stream the response body through RPC events so SSE (an infinite stream) and
    // large bodies work over the worker boundary; request/text() cannot await an
    // SSE response to completion. `streamID` opts in; non-streaming responses
    // keep returning the buffered body.
    if (input.streamID === undefined || !response.body) {
      const body = await response.text()
      workerLog("[worker:fetch]", input.url, "->", response.status, "streamID:", input.streamID, "body:", body.slice(0, 80))
      return { status: response.status, headers: responseHeaders, body }
    }
    workerLog("[worker:fetch:stream]", input.url, "->", response.status, "ct:", response.headers.get("content-type"))
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
