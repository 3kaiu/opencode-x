import type {
  AgentV2Info,
  CommandV2Info,
  IntegrationInfo,
  LocationRef,
  ModelV2Info,
  PermissionSavedInfo,
  PermissionV2Request,
  ProviderV2Info,
  QuestionV2Request,
  ReferenceInfo,
  SessionMessage,
  SessionMessageAssistant,
  SessionMessageAssistantReasoning,
  SessionMessageAssistantText,
  SessionMessageAssistantTool,
  SessionV2Info,
  SkillV2Info,
  V2Event,
} from "@opencode-ai/sdk/v2"
import { createStore, produce } from "solid-js/store"
import { createSimpleContext } from "./helper"
import { useSDK } from "./sdk"
import { useEvent } from "./event"
import { useRoute } from "./route"
import { useToast } from "../ui/toast"
import { debugLog } from "../util/debug"

const debugEnabled = process.env.OPENCODE_DEBUG_LOG === "1"
import { batch, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js"

// Session event types that are published live only: they never reach the durable
// log, so the session-scoped cursor stream (durable replay) cannot deliver them.
// The active-session dedup must skip ONLY these, otherwise text/reasoning/tool
// deltas and run failures are dropped and the UI stops streaming. Keep in sync
// with DurableDefinitions in packages/schema/src/session-event.ts. Note:
// session.next.failed is durable (not in this set) and arrives via the cursor.
const LIVE_ONLY_SESSION_EVENTS = new Set([
  "session.next.subagent.requested",
  "session.next.subagent.result",
  "session.next.text.delta",
  "session.next.reasoning.delta",
  "session.next.tool.input.delta",
  "session.next.compaction.delta",
  "session.next.steer.pending",
])

type LocationData = {
  agent?: AgentV2Info[]
  command?: CommandV2Info[]
  integration?: IntegrationInfo[]
  model?: ModelV2Info[]
  provider?: ProviderV2Info[]
  reference?: ReferenceInfo[]
  skill?: SkillV2Info[]
}

type Data = {
  session: {
    info: Record<string, SessionV2Info>
    message: Record<string, SessionMessage[]>
    permission: Record<string, PermissionV2Request[]>
    question: Record<string, QuestionV2Request[]>
  }
  project: {
    permission: Record<string, PermissionSavedInfo[]>
  }
  location: Record<string, LocationData>
}

function locationKey(location: LocationRef) {
  return JSON.stringify([location.directory, location.workspaceID])
}

function locationQuery(ref?: LocationRef) {
  return ref ? { directory: ref.directory, workspace: ref.workspaceID } : undefined
}

export const { use: useData, provider: DataProvider } = createSimpleContext({
  name: "Data",
  init: () => {
    const [store, setStore] = createStore<Data>({
      session: {
        info: {},
        message: {},
        permission: {},
        question: {},
      },
      project: {
        permission: {},
      },
      location: {},
    })

    const sdk = useSDK()
    const events = useEvent()
    const toast = useToast()
    const [defaultLocation, setDefaultLocation] = createSignal<LocationRef>({
      directory: sdk.directory ?? process.cwd(),
    })

    // Admitted prompts that have not yet been promoted (messageID per session).
    // A durable PromptAdmitted without a matching Prompted means the input is
    // stranded: admitted but never drained, e.g. after a crash or an idle
    // interruption. The cursor replay re-emits these; notice once per session.
    const pendingAdmits = new Map<string, Set<string>>()
    const pendingNoticed = new Set<string>()

    const message = {
      update(sessionID: string, fn: (messages: SessionMessage[]) => void) {
        setStore(
          "session",
          "message",
          produce((draft) => {
            fn((draft[sessionID] ??= []))
          }),
        )
      },
      prepend(messages: SessionMessage[], item: SessionMessage) {
        if (messages.some((existing) => existing.id === item.id)) return
        messages.unshift(item)
      },
      activeAssistant(messages: SessionMessage[]) {
        const item = messages.find((item) => item.type === "assistant" && !item.time.completed)
        return item?.type === "assistant" ? item : undefined
      },
      assistant(messages: SessionMessage[], messageID: string) {
        const item = messages.find((item) => item.type === "assistant" && item.id === messageID)
        return item?.type === "assistant" ? item : undefined
      },
      activeShell(messages: SessionMessage[], callID: string) {
        const item = messages.find((item) => item.type === "shell" && item.callID === callID)
        return item?.type === "shell" ? item : undefined
      },
      latestTool(assistant: SessionMessageAssistant | undefined, callID?: string) {
        return assistant?.content.findLast(
          (item): item is SessionMessageAssistantTool =>
            item.type === "tool" && (callID === undefined || item.id === callID),
        )
      },
      latestText(assistant: SessionMessageAssistant | undefined, textID: string) {
        return assistant?.content.findLast(
          (item): item is SessionMessageAssistantText => item.type === "text" && item.id === textID,
        )
      },
      latestReasoning(assistant: SessionMessageAssistant | undefined, reasoningID: string) {
        return assistant?.content.findLast(
          (item): item is SessionMessageAssistantReasoning => item.type === "reasoning" && item.id === reasoningID,
        )
      },
    }

    function handleEvent(event: V2Event) {
      const start = debugEnabled ? performance.now() : 0
      switch (event.type) {
        case "catalog.updated":
          void Promise.all([
            result.location.model.refresh(event.location),
            result.location.provider.refresh(event.location),
          ]).catch((error) => console.error("Failed to refresh catalog", error))
          break
        case "session.next.agent.switched":
          message.update(event.data.sessionID, (draft) => {
            message.prepend(draft, {
              id: event.data.messageID,
              type: "agent-switched",
              agent: event.data.agent,
              time: { created: event.data.timestamp },
            })
          })
          break
        case "session.next.model.switched":
          message.update(event.data.sessionID, (draft) => {
            message.prepend(draft, {
              id: event.data.messageID,
              type: "model-switched",
              model: event.data.model,
              time: { created: event.data.timestamp },
            })
          })
          break
        case "session.next.prompted": {
          const pending = pendingAdmits.get(event.data.sessionID)
          if (pending) {
            pending.delete(event.data.messageID)
            if (pending.size === 0) pendingAdmits.delete(event.data.sessionID)
          }
          message.update(event.data.sessionID, (draft) => {
            message.prepend(draft, {
              id: event.data.messageID,
              type: "user",
              text: event.data.prompt.text,
              files: event.data.prompt.files,
              agents: event.data.prompt.agents,
              time: { created: event.data.timestamp },
            })
          })
          break
        }
        case "session.next.prompt.admitted": {
          // Track admissions until their Prompted; if one stays unresolved while
          // the session is not draining it is stranded input (e.g. post-crash).
          const admitted = pendingAdmits.get(event.data.sessionID)
          if (admitted) admitted.add(event.data.messageID)
          else pendingAdmits.set(event.data.sessionID, new Set([event.data.messageID]))
          const messageID = event.data.messageID
          const sessionID = event.data.sessionID
          const preview = event.data.prompt.text.trim().replace(/\s+/g, " ").slice(0, 60)
          setTimeout(() => {
            if (!pendingAdmits.get(sessionID)?.has(messageID)) return
            if (pendingNoticed.has(sessionID)) return
            void sdk.client.v2.session
              .active()
              .then((res) => {
                const running = res?.data
                if (running && sessionID in running) return
                pendingNoticed.add(sessionID)
                toast.show({
                  variant: "warning",
                  title: "未处理的输入",
                  message: preview ? `“${preview}…” 已提交但未开始处理（可能因中断或重启遗留），发送新消息可继续` : "此会话有已提交但未处理的消息，发送新消息可继续",
                  duration: 8000,
                })
              })
              .catch(() => {})
          }, 800)
          break
        }
        case "session.next.context.updated":
          message.update(event.data.sessionID, (draft) => {
            message.prepend(draft, {
              id: event.data.messageID,
              type: "system",
              text: event.data.text,
              time: { created: event.data.timestamp },
            })
          })
          break
        case "session.next.synthetic":
          message.update(event.data.sessionID, (draft) => {
            message.prepend(draft, {
              id: event.data.messageID,
              type: "synthetic",
              sessionID: event.data.sessionID,
              text: event.data.text,
              time: { created: event.data.timestamp },
            })
          })
          break
        case "session.next.shell.started":
          message.update(event.data.sessionID, (draft) => {
            message.prepend(draft, {
              id: event.data.messageID,
              type: "shell",
              callID: event.data.callID,
              command: event.data.command,
              output: "",
              time: { created: event.data.timestamp },
            })
          })
          break
        case "session.next.shell.ended":
          message.update(event.data.sessionID, (draft) => {
            const match = message.activeShell(draft, event.data.callID)
            if (!match) return
            match.output = event.data.output
            match.time.completed = event.data.timestamp
          })
          break
        case "session.next.step.started":
          message.update(event.data.sessionID, (draft) => {
            if (draft.some((message) => message.id === event.data.assistantMessageID)) return
            const currentAssistant = message.activeAssistant(draft)
            if (currentAssistant) currentAssistant.time.completed = event.data.timestamp
            message.prepend(draft, {
              id: event.data.assistantMessageID,
              type: "assistant",
              agent: event.data.agent,
              model: event.data.model,
              content: [],
              snapshot: event.data.snapshot ? { start: event.data.snapshot } : undefined,
              time: { created: event.data.timestamp },
            })
          })
          break
        case "session.next.step.ended":
          message.update(event.data.sessionID, (draft) => {
            const currentAssistant = message.assistant(draft, event.data.assistantMessageID)
            if (!currentAssistant) return
            currentAssistant.time.completed = event.data.timestamp
            currentAssistant.finish = event.data.finish
            currentAssistant.cost = event.data.cost
            currentAssistant.tokens = event.data.tokens
            if (event.data.snapshot)
              currentAssistant.snapshot = { ...currentAssistant.snapshot, end: event.data.snapshot }
          })
          break
        case "session.next.step.failed":
          message.update(event.data.sessionID, (draft) => {
            const currentAssistant = message.assistant(draft, event.data.assistantMessageID)
            if (!currentAssistant) return
            currentAssistant.time.completed = event.data.timestamp
            currentAssistant.finish = "error"
            currentAssistant.error = event.data.error
          })
          break
        case "session.next.failed":
          toast.show({
            variant: "error",
            title: "会话运行失败",
            message: event.data.error.message,
            duration: 8000,
          })
          break
        case "session.next.text.started":
          message.update(event.data.sessionID, (draft) => {
            const assistant = message.assistant(draft, event.data.assistantMessageID)
            if (assistant && !assistant.content.some((item) => item.type === "text" && item.id === event.data.textID)) {
              assistant.content.push({
                type: "text",
                id: event.data.textID,
                text: "",
              })
            }
          })
          break
        case "session.next.text.delta":
          message.update(event.data.sessionID, (draft) => {
            const match = message.latestText(message.assistant(draft, event.data.assistantMessageID), event.data.textID)
            if (match) match.text += event.data.delta
          })
          break
        case "session.next.text.ended":
          message.update(event.data.sessionID, (draft) => {
            const match = message.latestText(message.assistant(draft, event.data.assistantMessageID), event.data.textID)
            if (match) match.text = event.data.text
          })
          break
        case "session.next.tool.input.started":
          message.update(event.data.sessionID, (draft) => {
            const assistant = message.assistant(draft, event.data.assistantMessageID)
            if (assistant && !assistant.content.some((item) => item.type === "tool" && item.id === event.data.callID)) {
              assistant.content.push({
                type: "tool",
                id: event.data.callID,
                name: event.data.name,
                time: { created: event.data.timestamp },
                state: { status: "pending", input: "" },
              })
            }
          })
          break
        case "session.next.tool.input.delta":
          message.update(event.data.sessionID, (draft) => {
            const match = message.latestTool(message.assistant(draft, event.data.assistantMessageID), event.data.callID)
            if (match?.state.status === "pending") match.state.input += event.data.delta
          })
          break
        case "session.next.tool.input.ended":
          message.update(event.data.sessionID, (draft) => {
            const match = message.latestTool(message.assistant(draft, event.data.assistantMessageID), event.data.callID)
            if (match?.state.status === "pending") match.state.input = event.data.text
          })
          break
        case "session.next.tool.called":
          message.update(event.data.sessionID, (draft) => {
            const match = message.latestTool(message.assistant(draft, event.data.assistantMessageID), event.data.callID)
            if (!match) return
            match.time.ran = event.data.timestamp
            match.provider = event.data.provider
            match.state = { status: "running", input: event.data.input, structured: {}, content: [] }
          })
          break
        case "session.next.tool.progress":
          message.update(event.data.sessionID, (draft) => {
            const match = message.latestTool(message.assistant(draft, event.data.assistantMessageID), event.data.callID)
            if (match?.state.status !== "running") return
            match.state.structured = event.data.structured
            match.state.content = [...event.data.content]
          })
          break
        case "session.next.tool.success":
          message.update(event.data.sessionID, (draft) => {
            const match = message.latestTool(message.assistant(draft, event.data.assistantMessageID), event.data.callID)
            if (match?.state.status !== "running") return
            match.state = {
              status: "completed",
              input: match.state.input,
              structured: event.data.structured,
              content: [...event.data.content],
              result: event.data.result,
            }
            match.provider = {
              executed: event.data.provider.executed || match.provider?.executed === true,
              metadata: match.provider?.metadata,
              resultMetadata: event.data.provider.metadata,
            }
            match.time.completed = event.data.timestamp
          })
          break
        case "session.next.tool.failed":
          message.update(event.data.sessionID, (draft) => {
            const match = message.latestTool(message.assistant(draft, event.data.assistantMessageID), event.data.callID)
            if (!match || (match.state.status !== "pending" && match.state.status !== "running")) return
            match.state = {
              status: "error",
              error: event.data.error,
              input: typeof match.state.input === "string" ? {} : match.state.input,
              structured: match.state.status === "running" ? match.state.structured : {},
              content: match.state.status === "running" ? match.state.content : [],
              result: event.data.result,
            }
            match.provider = {
              executed: event.data.provider.executed || match.provider?.executed === true,
              metadata: match.provider?.metadata,
              resultMetadata: event.data.provider.metadata,
            }
            match.time.completed = event.data.timestamp
          })
          break
        case "session.next.reasoning.started":
          message.update(event.data.sessionID, (draft) => {
            const assistant = message.assistant(draft, event.data.assistantMessageID)
            if (assistant && !assistant.content.some((item) => item.type === "reasoning" && item.id === event.data.reasoningID)) {
              assistant.content.push({
                type: "reasoning",
                id: event.data.reasoningID,
                text: "",
                providerMetadata: event.data.providerMetadata,
                time: { created: event.data.timestamp },
              })
            }
          })
          break
        case "session.next.reasoning.delta":
          message.update(event.data.sessionID, (draft) => {
            const match = message.latestReasoning(
              message.assistant(draft, event.data.assistantMessageID),
              event.data.reasoningID,
            )
            if (match) match.text += event.data.delta
          })
          break
        case "session.next.reasoning.ended":
          message.update(event.data.sessionID, (draft) => {
            const match = message.latestReasoning(
              message.assistant(draft, event.data.assistantMessageID),
              event.data.reasoningID,
            )
            if (match) {
              match.text = event.data.text
              match.time = {
                created: match.time?.created ?? event.data.timestamp,
                completed: event.data.timestamp,
              }
              if (event.data.providerMetadata !== undefined) match.providerMetadata = event.data.providerMetadata
            }
          })
          break
        case "session.next.retried":
        case "session.next.compaction.started":
        case "session.next.compaction.delta":
          break
        case "session.next.compaction.ended":
          message.update(event.data.sessionID, (draft) => {
            message.prepend(draft, {
              id: event.data.messageID,
              type: "compaction",
              reason: event.data.reason,
              summary: event.data.text,
              recent: event.data.recent,
              time: { created: event.data.timestamp },
            })
          })
          break
        case "reference.updated":
          void result.location.reference.refresh().catch((error) => console.error("Failed to refresh references", error))
          break
        case "integration.updated":
          void Promise.all([
            result.location.integration.refresh(event.location),
            result.location.model.refresh(event.location),
            result.location.provider.refresh(event.location),
          ]).catch((error) => console.error("Failed to refresh integrations", error))
          break
      }
      if (debugEnabled) {
        const elapsed = performance.now() - start
        if (elapsed > 5) debugLog("[handleEvent:slow]", event.type, `${elapsed.toFixed(2)}ms`)
      }
    }

    // Session-scoped event subscription: when a session route is active,
    // subscribe to cursor-based session events for replay + real-time.
    // Global SSE events for the subscribed session are skipped to avoid duplicates.
    const route = useRoute()
    const [subscribedSession, setSubscribedSession] = createSignal<string | undefined>()

    // Derive the session ID by value so the subscription effect only re-runs when the active
    // session actually changes. Writing `subscribedSession` inside the effect must not re-trigger
    // it (previously the effect read that signal for its guard, so the write caused an immediate
    // re-run whose onCleanup aborted the subscription it had just created).
    const activeSessionID = createMemo(() => {
      const r = route.data
      return r.type === "session" ? r.sessionID : undefined
    })

    createEffect(() => {
      const sessionID = activeSessionID()
      setSubscribedSession(sessionID)
      if (!sessionID) return

      const ctrl = new AbortController()
      let cursor: string | undefined

      const subscribe = async () => {
        debugLog("[data:cursor]", sessionID, "subscribe after:", cursor)
        try {
          const events = await sdk.client.v2.session.events(
            { sessionID, after: cursor },
            { signal: ctrl.signal, sseMaxRetryAttempts: 0 },
          )
          const iterator = events.stream[Symbol.asyncIterator]()
          const aborted = new Promise<"aborted">((resolve) => {
            ctrl.signal.addEventListener("abort", () => resolve("aborted"), { once: true })
          })
          let count = 0
          while (true) {
            const next = await Promise.race([iterator.next(), aborted])
            if (next === "aborted" || ctrl.signal.aborted) {
              await iterator.return?.()
              break
            }
            if (next.done) break
            // The session.events SSE stream yields the full V2Event directly
            // (type/durable/data). The SDK's typed `{id, event, data}` envelope
            // is a type-level artifact; unwrapping `.data` would return the event
            // payload and lose `type`, silently dropping the whole replay.
            const event = next.value as unknown as V2Event
            // The effect StreamSse encoder never emits an SSE `id:` line, so the
            // SDK's Last-Event-ID cursor cannot advance. Track the cursor from the
            // durable aggregate sequence instead and resume there on reconnect.
            const seq = event.durable?.seq
            if (typeof seq === "number" && seq > Number(cursor ?? -1)) cursor = String(seq)
            count += 1
            debugLog("[data:cursor:recv]", sessionID, event.type, "seq:", seq ?? "live", "n:", count)
            // The initial replay can be large; batch store updates so the UI
            // renders once per chunk instead of per event.
            batch(() => handleEvent(event as V2Event))
          }
          debugLog("[data:cursor:end]", sessionID, "stream ended, count:", count, "cursor:", cursor)
          // `sseMaxRetryAttempts: 0` surfaces transient failures as a clean
          // `done` instead of throwing, so reaching here means the stream ended
          // (error or disconnect). Reconnect from the last seq unless aborted.
          if (!ctrl.signal.aborted) {
            await new Promise((resolve) => setTimeout(resolve, 1000))
            if (!ctrl.signal.aborted) void subscribe()
          }
        } catch (error) {
          debugLog("[data:cursor:error]", sessionID, error)
          // Reconnect with backoff if not aborted
          if (!ctrl.signal.aborted) {
            await new Promise((resolve) => setTimeout(resolve, 1000))
            if (!ctrl.signal.aborted) void subscribe()
          }
        }
      }
      void subscribe()

      onCleanup(() => ctrl.abort())
    })

    onMount(() => {
      const unsub = events.subscribe((event, metadata) => {
        // The session-scoped cursor subscription replays durable events for the
        // active session, so skip those here to avoid double-application. Live-only
        // events (deltas, failed, steer.pending) never reach the cursor and must
        // keep flowing through the global stream.
        const active = subscribedSession()
        const deduped =
          active &&
          event.type.startsWith("session.next.") &&
          !LIVE_ONLY_SESSION_EVENTS.has(event.type) &&
          (event.properties as { sessionID?: string }).sessionID === active
        debugLog(
          "[data:global]",
          event.type,
          "sessionID:",
          (event.properties as { sessionID?: string }).sessionID,
          "active:",
          active,
          deduped ? "DEDUPED" : "->store",
        )
        if (deduped) return
        handleEvent({
          ...event,
          data: event.properties,
          location: { directory: metadata.directory, workspaceID: metadata.workspace },
        } as V2Event)
      })
      onCleanup(unsub)
    })

    const result = {
      session: {
        get(sessionID: string) {
          return store.session.info[sessionID]
        },
        async refresh(sessionID: string) {
          const result = await sdk.client.v2.session.get({ sessionID }, { throwOnError: true })
          setStore("session", "info", sessionID, result.data.data)
        },
        message: {
          list(sessionID: string) {
            return store.session.message[sessionID]
          },
          async refresh(sessionID: string) {
            const result = await sdk.client.v2.session.messages({ sessionID }, { throwOnError: true })
            setStore("session", "message", sessionID, result.data.data)
          },
        },
        permission: {
          list(sessionID: string) {
            return store.session.permission[sessionID]
          },
          async refresh(sessionID: string) {
            const result = await sdk.client.v2.session.permission.list({ sessionID }, { throwOnError: true })
            setStore("session", "permission", sessionID, result.data.data)
          },
        },
        question: {
          list(sessionID: string) {
            return store.session.question[sessionID]
          },
          async refresh(sessionID: string) {
            const result = await sdk.client.v2.session.question.list({ sessionID }, { throwOnError: true })
            setStore("session", "question", sessionID, result.data.data)
          },
        },
      },
      project: {
        permission: {
          list(projectID: string) {
            return store.project.permission[projectID]
          },
          async refresh(projectID: string) {
            const result = await sdk.client.v2.permission.saved.list({ projectID }, { throwOnError: true })
            setStore("project", "permission", projectID, result.data.data)
          },
        },
      },
      location: {
        default() {
          return defaultLocation()
        },
        async refresh(ref?: LocationRef) {
          const response = await sdk.client.v2.location.get({ location: locationQuery(ref) }, { throwOnError: true })
          const location = response.data
          const key = locationKey(location)
          if (!store.location[key]) setStore("location", key, {})
          if (!ref) setDefaultLocation({ directory: location.directory, workspaceID: location.workspaceID })
        },
        agent: {
          list(location?: LocationRef) {
            return store.location[locationKey(location ?? defaultLocation())]?.agent
          },
          async refresh(ref?: LocationRef) {
            const result = await sdk.client.v2.agent.list({ location: locationQuery(ref) }, { throwOnError: true })
            const key = locationKey(result.data.location)
            setStore("location", key, "agent", result.data.data)
          },
        },
        command: {
          list(location?: LocationRef) {
            return store.location[locationKey(location ?? defaultLocation())]?.command
          },
          async refresh(ref?: LocationRef) {
            const result = await sdk.client.v2.command.list({ location: locationQuery(ref) }, { throwOnError: true })
            const key = locationKey(result.data.location)
            setStore("location", key, "command", result.data.data)
          },
        },
        integration: {
          list(location?: LocationRef) {
            return store.location[locationKey(location ?? defaultLocation())]?.integration
          },
          async refresh(ref?: LocationRef) {
            const result = await sdk.client.v2.integration.list(
              { location: locationQuery(ref) },
              { throwOnError: true },
            )
            const key = locationKey(result.data.location)
            setStore("location", key, "integration", result.data.data)
          },
        },
        model: {
          list(location?: LocationRef) {
            return store.location[locationKey(location ?? defaultLocation())]?.model
          },
          async refresh(ref?: LocationRef) {
            const result = await sdk.client.v2.model.list({ location: locationQuery(ref) }, { throwOnError: true })
            const key = locationKey(result.data.location)
            setStore("location", key, "model", result.data.data)
          },
        },
        provider: {
          list(location?: LocationRef) {
            return store.location[locationKey(location ?? defaultLocation())]?.provider
          },
          async refresh(ref?: LocationRef) {
            const result = await sdk.client.v2.provider.list({ location: locationQuery(ref) }, { throwOnError: true })
            const key = locationKey(result.data.location)
            setStore("location", key, "provider", result.data.data)
          },
        },
        reference: {
          list(location?: LocationRef) {
            return store.location[locationKey(location ?? defaultLocation())]?.reference
          },
          async refresh(ref?: LocationRef) {
            const result = await sdk.client.v2.reference.list({ location: locationQuery(ref) }, { throwOnError: true })
            const key = locationKey(result.data.location)
            setStore("location", key, "reference", result.data.data)
          },
        },
        skill: {
          list(location?: LocationRef) {
            return store.location[locationKey(location ?? defaultLocation())]?.skill
          },
          async refresh(ref?: LocationRef) {
            const result = await sdk.client.v2.skill.list({ location: locationQuery(ref) }, { throwOnError: true })
            const key = locationKey(result.data.location)
            setStore("location", key, "skill", result.data.data)
          },
        },
      },
    }

    onMount(() => {
      void Promise.allSettled([
        result.location.refresh(),
        result.location.agent.refresh(),
        result.location.integration.refresh(),
        result.location.model.refresh(),
        result.location.provider.refresh(),
        result.location.reference.refresh(),
        result.location.command.refresh(),
        result.location.skill.refresh(),
      ]).then((settled) => {
        for (const failure of settled.filter((item) => item.status === "rejected"))
          console.error("Failed to refresh default location data", failure.reason)
      })
    })

    return result
  },
})
