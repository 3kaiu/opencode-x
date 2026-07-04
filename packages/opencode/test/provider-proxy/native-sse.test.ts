import { describe, expect, test } from "bun:test"
import { createServer } from "http"

let nextPort = 21000

function startSseServer(events: { event?: string; data: string; id?: string; delay?: number }[]): Promise<{ close: () => void; port: number }> {
  const port = nextPort++
  return new Promise((resolve) => {
    const server = createServer((_req, res) => {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      })

      events.forEach((e, i) => {
        const ms = e.delay ?? 5
        setTimeout(() => {
          if (e.event) res.write(`event: ${e.event}\n`)
          if (e.id) res.write(`id: ${e.id}\n`)
          // Split multiline data into separate data: lines (SSE spec)
          const lines = e.data.split("\n")
          lines.forEach((line) => res.write(`data: ${line}\n`))
          res.write("\n")
          if (i === events.length - 1) {
            setTimeout(() => res.end(), 10)
          }
        }, ms * (i + 1))
      })
    })
    server.listen(port, () => resolve({ close: () => server.close(), port }))
  })
}

const { streamSse: nativeStreamSse } = require("../../src/provider-proxy/index.node") as {
  streamSse: (
    options: { url: string; method: string; headers: [string, string][]; body: string; timeoutMs?: number },
    onEvent: (err: unknown, event: { data: string; eventType?: string; id?: string }) => void,
    onError: (err: unknown, msg: string) => void,
    onDone: (err: unknown) => void,
  ) => Promise<void>
}

describe("provider-proxy SSE streaming", () => {
  test("basic SSE events", async () => {
    const { close, port } = await startSseServer([
      { data: "connected", event: "start" },
      { data: "hello world" },
      { data: "chunk 1", event: "delta", id: "42" },
      { data: "chunk 2" },
      { data: "[DONE]" },
    ])

    const received: string[] = []
    await nativeStreamSse(
      { url: `http://localhost:${port}/sse`, method: "POST", headers: [], body: "", timeoutMs: 5000 },
      (_err, event) => { received.push(event.data) },
      () => {},
      () => {},
    )

    expect(received).toHaveLength(5)
    expect(received[0]).toBe("connected")
    expect(received[1]).toBe("hello world")
    expect(received[2]).toBe("chunk 1")
    expect(received[3]).toBe("chunk 2")
    expect(received[4]).toBe("[DONE]")
    close()
  })

  test("multiline data (concatenated via multiple data: lines)", async () => {
    const { close, port } = await startSseServer([
      { data: "line1\nline2\nline3" },
    ])

    const received: string[] = []
    await nativeStreamSse(
      { url: `http://localhost:${port}/sse`, method: "POST", headers: [], body: "", timeoutMs: 5000 },
      (_err, event) => { received.push(event.data) },
      () => {},
      () => {},
    )

    expect(received).toHaveLength(1)
    expect(received[0]).toBe("line1\nline2\nline3")
    close()
  })

  test("event metadata fields", async () => {
    const { close, port } = await startSseServer([
      { data: "chunk", event: "delta", id: "evt_1" },
    ])

    const events: { data: string; eventType?: string; id?: string }[] = []
    await nativeStreamSse(
      { url: `http://localhost:${port}/sse`, method: "POST", headers: [], body: "", timeoutMs: 5000 },
      (_err, event) => { events.push(event) },
      () => {},
      () => {},
    )

    expect(events).toHaveLength(1)
    expect(events[0].data).toBe("chunk")
    expect(events[0].eventType).toBe("delta")
    expect(events[0].id).toBe("evt_1")
    close()
  })
})
