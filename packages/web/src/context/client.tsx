import { createOpencodeClient, type GlobalEvent } from "@opencode-ai/sdk/v2/client"
import type {
  SessionInfo,
  SessionMessage,
  SessionMessageAssistant,
  SessionMessageAssistantText,
  SessionMessageAssistantTool,
  SessionMessageUser,
} from "@opencode-ai/sdk/v2/types"
import { createSimpleContext } from "./helper"
import { batch, onCleanup, onMount } from "solid-js"
import { createStore, produce } from "solid-js/store"

export type { SessionInfo, SessionMessage }
export type Store = Store_

type Store_ = {
  sessions: SessionInfo[]
  messages: Record<string, SessionMessage[]>
  active: string | undefined
}

function upsertMessage(store: Store, sessionID: string, message: SessionMessage) {
  const messages = store.messages[sessionID] ?? []
  const index = messages.findIndex((existing) => existing.id === message.id)
  if (index >= 0) messages[index] = message
  else messages.push(message)
  store.messages[sessionID] = messages
}

function upsertPart(sessionID: string, messageID: string, part: SessionMessageAssistant["content"][number]) {
  return (store: Store) => {
    const messages = store.messages[sessionID]
    const message = messages?.find((existing) => existing.id === messageID)
    if (!message || message.type !== "assistant") return
    const index = message.content.findIndex((existing) => existing.id === part.id)
    if (index >= 0) message.content[index] = part
    else message.content.push(part)
  }
}

function assistant(messages: SessionMessage[] | undefined, messageID: string) {
  const message = messages?.find((existing) => existing.id === messageID)
  return message && message.type === "assistant" ? message : undefined
}

export function applyEvent(store: Store, payload: GlobalEvent["payload"]) {
  switch (payload.type) {
    case "session.next.prompt.admitted": {
      const { sessionID, messageID, timestamp, prompt } = payload.properties
      upsertMessage(store, sessionID, {
        id: messageID,
        type: "user",
        text: prompt.text,
        time: { created: timestamp },
      } satisfies SessionMessageUser)
      break
    }
    case "session.next.step.started": {
      const { sessionID, assistantMessageID, timestamp, agent, model } = payload.properties
      upsertMessage(store, sessionID, {
        id: assistantMessageID,
        type: "assistant",
        agent,
        model,
        content: [],
        time: { created: timestamp },
      } satisfies SessionMessageAssistant)
      break
    }
    case "session.next.text.started": {
      const { sessionID, assistantMessageID, textID } = payload.properties
      const existing = assistant(store.messages[sessionID], assistantMessageID)
      if (existing && existing.content.some((part) => part.type === "text" && part.id === textID)) break
      upsertPart(sessionID, assistantMessageID, {
        type: "text",
        id: textID,
        text: "",
      } satisfies SessionMessageAssistantText)(store)
      break
    }
    case "session.next.text.delta": {
      const { sessionID, assistantMessageID, textID, delta } = payload.properties
      const match = assistant(store.messages[sessionID], assistantMessageID)?.content.find(
        (part) => part.type === "text" && part.id === textID,
      )
      if (match?.type === "text") match.text += delta
      break
    }
    case "session.next.text.ended": {
      const { sessionID, assistantMessageID, textID, text } = payload.properties
      const match = assistant(store.messages[sessionID], assistantMessageID)?.content.find(
        (part) => part.type === "text" && part.id === textID,
      )
      if (match?.type === "text") match.text = text
      break
    }
    case "session.next.tool.input.started": {
      const { sessionID, assistantMessageID, callID, name, timestamp } = payload.properties
      const existing = assistant(store.messages[sessionID], assistantMessageID)
      if (existing && existing.content.some((part) => part.type === "tool" && part.id === callID)) break
      upsertPart(sessionID, assistantMessageID, {
        type: "tool",
        id: callID,
        name,
        state: { status: "pending", input: "" },
        time: { created: timestamp },
      } satisfies SessionMessageAssistantTool)(store)
      break
    }
    case "session.next.tool.input.delta": {
      const { sessionID, assistantMessageID, callID, delta } = payload.properties
      const match = assistant(store.messages[sessionID], assistantMessageID)?.content.find(
        (part) => part.type === "tool" && part.id === callID,
      )
      if (match?.type === "tool" && match.state.status === "pending") match.state.input += delta
      break
    }
    case "session.next.tool.input.ended": {
      const { sessionID, assistantMessageID, callID, text } = payload.properties
      const match = assistant(store.messages[sessionID], assistantMessageID)?.content.find(
        (part) => part.type === "tool" && part.id === callID,
      )
      if (match?.type === "tool" && match.state.status === "pending") match.state.input = text
      break
    }
    case "session.next.tool.called": {
      const { sessionID, assistantMessageID, callID, timestamp, input, provider, presentation } = payload.properties
      const match = assistant(store.messages[sessionID], assistantMessageID)?.content.find(
        (part) => part.type === "tool" && part.id === callID,
      )
      if (!match || match.type !== "tool") break
      match.time.ran = timestamp
      match.provider = provider
      match.state = { status: "running", input, structured: {}, content: [], presentation }
      break
    }
    case "session.next.tool.progress": {
      const { sessionID, assistantMessageID, callID, structured, content } = payload.properties
      const match = assistant(store.messages[sessionID], assistantMessageID)?.content.find(
        (part) => part.type === "tool" && part.id === callID,
      )
      if (match?.type !== "tool" || match.state.status !== "running") break
      match.state.structured = structured
      match.state.content = [...content]
      break
    }
    case "session.next.tool.success": {
      const { sessionID, assistantMessageID, callID, timestamp, structured, content, result, presentation } =
        payload.properties
      const match = assistant(store.messages[sessionID], assistantMessageID)?.content.find(
        (part) => part.type === "tool" && part.id === callID,
      )
      if (match?.type !== "tool" || match.state.status !== "running") break
      match.state = {
        status: "completed",
        input: match.state.input,
        structured,
        content: [...content],
        result,
        presentation,
      }
      match.time.completed = timestamp
      break
    }
    case "session.next.tool.failed": {
      const { sessionID, assistantMessageID, callID, timestamp, error, result, presentation } = payload.properties
      const match = assistant(store.messages[sessionID], assistantMessageID)?.content.find(
        (part) => part.type === "tool" && part.id === callID,
      )
      if (!match || match.type !== "tool" || (match.state.status !== "pending" && match.state.status !== "running"))
        break
      match.state = {
        status: "error",
        error,
        input: match.state.status === "pending" ? {} : match.state.input,
        structured: match.state.status === "running" ? match.state.structured : {},
        content: match.state.status === "running" ? match.state.content : [],
        result,
        presentation,
      }
      match.time.completed = timestamp
      break
    }
    case "session.next.reasoning.started": {
      const { sessionID, assistantMessageID, reasoningID, timestamp } = payload.properties
      const existing = assistant(store.messages[sessionID], assistantMessageID)
      if (existing && existing.content.some((part) => part.type === "reasoning" && part.id === reasoningID)) break
      upsertPart(sessionID, assistantMessageID, {
        type: "reasoning",
        id: reasoningID,
        text: "",
        time: { created: timestamp },
      })(store)
      break
    }
    case "session.next.reasoning.delta": {
      const { sessionID, assistantMessageID, reasoningID, delta } = payload.properties
      const match = assistant(store.messages[sessionID], assistantMessageID)?.content.find(
        (part) => part.type === "reasoning" && part.id === reasoningID,
      )
      if (match?.type === "reasoning") match.text += delta
      break
    }
    case "session.next.reasoning.ended": {
      const { sessionID, assistantMessageID, reasoningID, text } = payload.properties
      const match = assistant(store.messages[sessionID], assistantMessageID)?.content.find(
        (part) => part.type === "reasoning" && part.id === reasoningID,
      )
      if (match?.type === "reasoning") match.text = text
      break
    }
    case "session.next.step.ended":
    case "session.next.step.failed":
    case "session.next.failed": {
      const { sessionID, timestamp } = payload.properties
      const last = store.messages[sessionID]?.at(-1)
      if (last?.type === "assistant" && last.time.completed === undefined) last.time.completed = timestamp
      break
    }
  }
}

export const { use: useData, provider: DataProvider } = createSimpleContext({
  name: "WebData",
  init: (props: { url?: string; headers?: Record<string, string> }) => {
    const sdk = createOpencodeClient({
      baseUrl: props.url ?? (typeof window !== "undefined" ? window.location.origin : undefined),
      headers: props.headers,
    })

    const [store, setStore] = createStore<Store>({ sessions: [], messages: {}, active: undefined })

    const apply = (payload: GlobalEvent["payload"]) => {
      setStore(
        produce((draft) => {
          applyEvent(draft, payload)
        }),
      )
    }

    const openSession = async (sessionID: string) => {
      setStore("active", sessionID)
      const result = await sdk.v2.session.messages({ sessionID }, { throwOnError: true })
      setStore("messages", sessionID, result.data.data)
    }

    const refreshSessions = async () => {
      const result = await sdk.v2.session.list({ limit: 100 }, { throwOnError: true })
      setStore("sessions", result.data.data)
    }

    const createSession = async () => {
      const result = await sdk.v2.session.create({}, { throwOnError: true })
      const session = result.data.data
      setStore(
        produce((draft) => {
          draft.sessions.push(session)
        }),
      )
      return session.id
    }

    const prompt = async (sessionID: string, text: string) => {
      await sdk.v2.session.prompt({ sessionID, prompt: { text }, delivery: "steer" })
    }

    const interrupt = async (sessionID: string) => {
      await sdk.v2.session.interrupt({ sessionID })
    }

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
    let timer: ReturnType<typeof setTimeout> | undefined
    let last = 0

    const flush = () => {
      if (queue.length === 0) return
      const events = queue
      queue = []
      timer = undefined
      last = Date.now()
      batch(() => {
        for (const event of events) emitter.emit("event", event)
      })
    }

    const handleEvent = (event: GlobalEvent) => {
      queue.push(event)
      const elapsed = Date.now() - last
      if (timer) return
      if (elapsed < 16) {
        timer = setTimeout(flush, 16)
        return
      }
      flush()
    }

    let sse: AbortController | undefined

    function startSSE() {
      sse?.abort()
      const ctrl = new AbortController()
      sse = ctrl
      void (async () => {
        let attempt = 0
        while (true) {
          if (ctrl.signal.aborted) break
          try {
            const events = await sdk.global.event({ signal: ctrl.signal, sseMaxRetryAttempts: 0 })
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
          if (ctrl.signal.aborted) break
          const backoff = Math.min(1000 * 2 ** (attempt - 1), 30000)
          await new Promise((resolve) => setTimeout(resolve, backoff))
        }
      })().catch(() => {})
    }

    emitter.on("event", (event) => {
      apply(event.payload)
      if (event.payload.type === "session.created" || event.payload.type === "session.updated") {
        void refreshSessions()
      }
    })

    onMount(() => {
      void refreshSessions()
      startSSE()
    })

    onCleanup(() => {
      sse?.abort()
      if (timer) clearTimeout(timer)
      handlers.clear()
    })

    return {
      get client() {
        return sdk
      },
      get sessions() {
        return store.sessions
      },
      get active() {
        return store.active
      },
      messages(sessionID: string) {
        return store.messages[sessionID]
      },
      openSession,
      refreshSessions,
      createSession,
      prompt,
      interrupt,
    }
  },
})