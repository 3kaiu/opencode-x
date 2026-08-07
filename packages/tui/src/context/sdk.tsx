import { createOpencodeClient } from "@opencode-ai/sdk/v2"
import type { GlobalEvent } from "@opencode-ai/sdk/v2"
import { createSimpleContext } from "./helper"
import { batch, onCleanup, onMount } from "solid-js"
import { debugLog } from "../util/debug"

export type EventSource = {
  subscribe: (handler: (event: GlobalEvent) => void) => Promise<() => void>
}

export const { use: useSDK, provider: SDKProvider } = createSimpleContext({
  name: "SDK",
  init: (props: {
    url: string
    directory?: string
    fetch?: typeof fetch
    headers?: RequestInit["headers"]
    events?: EventSource
  }) => {
    const abort = new AbortController()
    let sse: AbortController | undefined

    function createSDK() {
      return createOpencodeClient({
        baseUrl: props.url,
        signal: abort.signal,
        directory: props.directory,
        fetch: props.fetch,
        headers: props.headers,
      })
    }

    const sdk = createSDK()

    const handlers = new Set<(event: GlobalEvent) => void>()
    const emitter = {
      emit(_type: "event", event: GlobalEvent) {
        for (const handler of handlers) handler(event)
      },
      on(_type: "event", handler: (event: GlobalEvent) => void) {
        handlers.add(handler)
        return () => {
          handlers.delete(handler)
        }
      },
    }

    let queue: GlobalEvent[] = []
    let timer: Timer | undefined
    let last = 0
    const retryDelay = 1000
    const maxRetryDelay = 30000
    let eventsPerSecond = 0
    let eventsPerSecondWindow = 0
    let eventsPerSecondTimer: Timer | undefined
    let maxQueueDepth = 0

    const flush = () => {
      if (queue.length === 0) return
      const events = queue
      queue = []
      timer = undefined
      last = Date.now()
      maxQueueDepth = Math.max(maxQueueDepth, events.length)
      if (events.length > 50) debugLog("[sdk:flush:large]", events.length, "events")
      const start = performance.now()
      // Batch all event emissions so all store updates result in a single render
      batch(() => {
        for (const event of events) {
          emitter.emit("event", event)
        }
      })
      const ms = performance.now() - start
      if (ms > 10) debugLog("[sdk:flush:slow]", events.length, "events", `${ms.toFixed(1)}ms`)
    }

    const handleEvent = (event: GlobalEvent) => {
      debugLog("[tui-sdk:event]", event.payload.type, JSON.stringify((event.payload as { properties?: unknown }).properties ?? {}).slice(0, 140))
      eventsPerSecondWindow += 1
      queue.push(event)
      const elapsed = Date.now() - last

      if (timer) return
      // If we just flushed recently (within 16ms), batch this with future events
      // Otherwise, process immediately to avoid latency
      if (elapsed < 16) {
        timer = setTimeout(flush, 16)
        return
      }
      flush()
    }

    function startSSE() {
      sse?.abort()
      const ctrl = new AbortController()
      sse = ctrl
      ;(async () => {
        let attempt = 0
        while (true) {
          if (abort.signal.aborted || ctrl.signal.aborted) break

          try {
            const events = await sdk.global.event({
              signal: ctrl.signal,
              sseMaxRetryAttempts: 0,
            })

            for await (const event of events.stream) {
              if (ctrl.signal.aborted) break
              attempt = 0
              handleEvent(event)
            }
          } catch {
            // fall through to backoff and reconnect
          }

          if (timer) clearTimeout(timer)
          if (queue.length > 0) flush()
          attempt += 1
          if (abort.signal.aborted || ctrl.signal.aborted) break

          // Exponential backoff
          const backoff = Math.min(retryDelay * 2 ** (attempt - 1), maxRetryDelay)
          await new Promise((resolve) => setTimeout(resolve, backoff))
        }
      })().catch(() => {})
    }

    onMount(() => {
      if (process.env.OPENCODE_DEBUG_LOG === "1") {
        eventsPerSecondTimer = setInterval(() => {
          debugLog("[sdk:rate]", eventsPerSecondWindow, "ev/s", "maxQueue:", maxQueueDepth)
          eventsPerSecondWindow = 0
          maxQueueDepth = 0
        }, 1000)
      }
      if (props.events) {
        const pending = props.events.subscribe(handleEvent)
        onCleanup(() => {
          void pending.then((unsub) => unsub())
        })
        return
      }
      startSSE()
    })

    onCleanup(() => {
      if (eventsPerSecondTimer) clearInterval(eventsPerSecondTimer)
      abort.abort()
      sse?.abort()
      if (timer) clearTimeout(timer)
      handlers.clear()
    })

    return {
      get client() {
        return sdk
      },
      directory: props.directory,
      event: emitter,
      fetch: props.fetch ?? fetch,
      url: props.url,
    }
  },
})
