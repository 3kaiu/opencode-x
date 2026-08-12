import type {
  AgentV2Info,
  Command as CommandV1,
  CommandV2Info,
  Config,
  Event,
  FormatterStatus,
  IntegrationInfo,
  LocationRef,
  LspStatus,
  McpStatus,
  Message,
  ModelV2Info,
  Part,
  PermissionSavedInfo,
  PermissionV2Request,
  Provider,
  ProviderAuthMethod,
  ProviderListResponse,
  ProviderV2Info,
  QuestionRequest,
  QuestionV2Request,
  ReferenceInfo,
  Session,
  SessionInfo,
  SessionMessage,
  SessionMessageAssistant,
  SessionMessageAssistantReasoning,
  SessionMessageAssistantText,
  SessionMessageAssistantTool,
  SessionStatus,
  SkillV2Info,
  SnapshotFileDiff,
  Todo,
  V2Event,
  VcsInfo,
} from "@opencode-ai/sdk/v2"
import { createStore, produce, reconcile } from "solid-js/store"
import { createSimpleContext } from "./helper"
import { useSDK } from "./sdk"
import { useEvent } from "./event"
import { useRoute } from "./route"
import { useToast } from "../ui/toast"
import { debugLog, mark, timed } from "../util/debug"
import { convertV2Messages } from "./v2-convert"
import { useProject } from "./project"
import { useTuiStartup } from "./runtime"
import { useExit } from "./exit"
import { useArgs } from "./args"
import { useKV } from "./kv"
import { usePermission } from "./permission"
import { batch, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js"
import path from "path"

const debugEnabled = process.env.OPENCODE_DEBUG_LOG === "1"

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

type InstanceData = {
  status: "loading" | "partial" | "complete"
  provider: Provider[]
  provider_default: Record<string, string>
  provider_next: ProviderListResponse
  provider_auth: Record<string, ProviderAuthMethod[]>
  agent: AgentV2Info[]
  command: CommandV1[]
  permission: {
    [sessionID: string]: PermissionRequest[]
  }
  question: {
    [sessionID: string]: QuestionRequest[]
  }
  config: Config
  session: Session[]
  session_status: {
    [sessionID: string]: SessionStatus
  }
  session_diff: {
    [sessionID: string]: SnapshotFileDiff[]
  }
  todo: {
    [sessionID: string]: Todo[]
  }
  lsp: LspStatus[]
  mcp: {
    [key: string]: McpStatus
  }
  reference: ReferenceInfo[]
  formatter: FormatterStatus[]
  vcs: VcsInfo | undefined
}

export type PermissionRequest = {
  id: string
  sessionID: string
  permission: string
  patterns: Array<string>
  metadata: Record<string, unknown>
  always: Array<string>
  tool?: { messageID: string; callID: string }
}

function locationKey(location: LocationRef) {
  return JSON.stringify([location.directory, location.workspaceID])
}

function locationQuery(ref?: LocationRef) {
  return ref ? { directory: ref.directory, workspace: ref.workspaceID } : undefined
}

// Adapter: V2 SessionInfo → V1 Session shape
function toV1Session(v2: SessionInfo): Session {
  return {
    id: v2.id,
    slug: v2.id, // V2 doesn't have slug, use id as fallback
    version: "2", // V2 sessions
    projectID: v2.projectID,
    workspaceID: v2.location.workspaceID,
    directory: v2.location.directory,
    path: v2.subpath,
    parentID: v2.parentID,
    cost: v2.cost,
    tokens: v2.tokens,
    title: v2.title,
    agent: v2.agent,
    model: v2.model
      ? {
          id: v2.model.id,
          providerID: v2.model.providerID,
          variant: v2.model.variant,
        }
      : undefined,
    time: {
      created: v2.time.created,
      updated: v2.time.updated,
      archived: v2.time.archived,
      compacting: undefined, // V2 doesn't expose compacting state in SessionInfo
    },
    revert: v2.revert,
    // V2 doesn't have these fields, leave undefined
    summary: undefined,
    share: undefined,
  }
}

function search<T>(items: T[], target: string, key: (item: T) => string) {
  let left = 0
  let right = items.length - 1
  while (left <= right) {
    const middle = Math.floor((left + right) / 2)
    const value = key(items[middle])
    if (value === target) return { found: true, index: middle }
    if (value < target) left = middle + 1
    else right = middle - 1
  }
  return { found: false, index: left }
}

// V2 permission requests carry {action, resources, save, source} instead of the
// V1-shaped {permission, patterns, always, tool} fields the permission UI
// consumes, so translate V2 payloads into the V1 shape.
function toPermissionRequest(event: Extract<Event, { type: "permission.v2.asked" }>): PermissionRequest {
  const request = event.properties
  return {
    id: request.id,
    sessionID: request.sessionID,
    permission: request.action,
    patterns: request.resources,
    always: request.save ?? [],
    metadata: request.metadata ?? {},
    ...(request.source
      ? { tool: { messageID: request.source.messageID, callID: request.source.callID } }
      : {}),
  }
}

type V1Projection = {
  messages: Message[]
  parts: Record<string, Part[]>
  status: SessionStatus
}

export const { use: useData, provider: DataProvider } = createSimpleContext({
  name: "Data",
  init: () => {
    const [store, setStore] = createStore<{
      session: {
        info: Record<string, SessionInfo>
        message: Record<string, SessionMessage[]>
        permission: Record<string, PermissionV2Request[]>
        question: Record<string, QuestionV2Request[]>
      }
      project: {
        permission: Record<string, PermissionSavedInfo[]>
      }
      location: Record<string, LocationData>
      instance: InstanceData
    }>({
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
      instance: {
        status: "loading",
        provider: [],
        provider_default: {},
        provider_next: {
          all: [],
          default: {},
          connected: [],
        },
        provider_auth: {},
        agent: [],
        command: [],
        permission: {},
        question: {},
        config: {},
        session: [],
        session_status: {},
        session_diff: {},
        todo: {},
        lsp: [],
        mcp: {},
        reference: [],
        formatter: [],
        vcs: undefined,
      },
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

    // ------------------------------------------------------------------
    // V1 projection: derive chrono Message[] + Part[] + status from the V2
    // message store so the rendering layer reads a single converged store.
    // ------------------------------------------------------------------
    const v1Projections = new Map<string, () => V1Projection>()
    const messageToSession = new Map<string, string>()
    function v1Projection(sessionID: string): V1Projection {
      let get = v1Projections.get(sessionID)
      if (!get) {
        get = createMemo(() =>
          convertV2Messages(sessionID, store.session.message[sessionID] ?? [], store.session.info[sessionID]),
        )
        v1Projections.set(sessionID, get)
      }
      const projection = get()
      for (const item of projection.messages) messageToSession.set(item.id, sessionID)
      return projection
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

    // ------------------------------------------------------------------
    // Instance-level sync (was SyncProvider): event-driven state updates.
    // ------------------------------------------------------------------
    const startup = useTuiStartup()
    const kv = useKV()
    const permissionMode = usePermission()
    const project = useProject()
    const exit = useExit()
    const args = useArgs()

    const syncingSessions = new Map<string, Promise<void>>()
    let lspStatusTimer: ReturnType<typeof setTimeout> | undefined
    const debouncedLspStatus = (workspace: string | undefined) => {
      if (lspStatusTimer) clearTimeout(lspStatusTimer)
      lspStatusTimer = setTimeout(() => {
        void sdk.client.lsp.status({ workspace }).then(
          (x) => setStore("instance", "lsp", x.data ?? []),
          () => {},
        )
      }, 300)
    }
    onCleanup(() => {
      if (lspStatusTimer) clearTimeout(lspStatusTimer)
    })

    function sessionListQuery(): { scope?: "project"; path?: string } {
      if (!kv.get("session_directory_filter_enabled", true)) return { scope: "project" }
      if (!project.data.instance.path.worktree || !project.data.instance.path.directory) return { scope: "project" }
      return {
        path: path
          .relative(path.resolve(project.data.instance.path.worktree), project.data.instance.path.directory)
          .replaceAll("\\", "/"),
      }
    }

    function listSessions() {
      const query = sessionListQuery()
      return sdk.client.v2.session
        .list({
          limit: 100,
          ...(query.path ? { subpath: query.path } : {}),
        })
        .then((x) =>
          (x.data?.data ?? [])
            .map(toV1Session)
            .toSorted((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
        )
    }

    const unsubscribe = events.subscribe((event, { directory, workspace }) => {
      switch (event.type) {
        case "server.instance.disposed":
          // The server restarted; re-bootstrap to re-establish all data.
          void bootstrap()
          break
        case "permission.replied":
        case "permission.v2.replied": {
          const requests = store.instance.permission[event.properties.sessionID]
          if (!requests) break
          const match = search(requests, event.properties.requestID, (r) => r.id)
          if (!match.found) break
          setStore(
            "instance",
            "permission",
            event.properties.sessionID,
            produce((draft) => {
              draft.splice(match.index, 1)
            }),
          )
          break
        }

        case "permission.v2.asked": {
          const request = toPermissionRequest(event)
          if (permissionMode.mode === "auto") {
            void sdk.client.v2.session.permission.reply({
              sessionID: request.sessionID,
              requestID: request.id,
              reply: "once",
            })
            break
          }
          const requests = store.instance.permission[request.sessionID]
          if (!requests) {
            setStore("instance", "permission", request.sessionID, [request])
            break
          }
          const match = search(requests, request.id, (r) => r.id)
          if (match.found) {
            setStore("instance", "permission", request.sessionID, match.index, reconcile(request))
            break
          }
          setStore(
            "instance",
            "permission",
            request.sessionID,
            produce((draft) => {
              draft.splice(match.index, 0, request)
            }),
          )
          break
        }

        case "question.replied":
        case "question.rejected":
        case "question.v2.replied":
        case "question.v2.rejected": {
          const requests = store.instance.question[event.properties.sessionID]
          if (!requests) break
          const match = search(requests, event.properties.requestID, (r) => r.id)
          if (!match.found) break
          setStore(
            "instance",
            "question",
            event.properties.sessionID,
            produce((draft) => {
              draft.splice(match.index, 1)
            }),
          )
          break
        }

        case "question.asked":
        case "question.v2.asked": {
          const request = event.properties
          const requests = store.instance.question[request.sessionID]
          if (!requests) {
            setStore("instance", "question", request.sessionID, [request])
            break
          }
          const match = search(requests, request.id, (r) => r.id)
          if (match.found) {
            setStore("instance", "question", request.sessionID, match.index, reconcile(request))
            break
          }
          setStore(
            "instance",
            "question",
            request.sessionID,
            produce((draft) => {
              draft.splice(match.index, 0, request)
            }),
          )
          break
        }

        case "todo.updated":
          setStore("instance", "todo", event.properties.sessionID, event.properties.todos)
          break

        case "session.diff":
          setStore("instance", "session_diff", event.properties.sessionID, event.properties.diff)
          break

        case "session.deleted": {
          const result = search(store.instance.session, event.properties.info.id, (s) => s.id)
          if (result.found) {
            setStore(
              "instance",
              "session",
              produce((draft) => {
                draft.splice(result.index, 1)
              }),
            )
          }
          break
        }
        case "session.updated": {
          const result = search(store.instance.session, event.properties.info.id, (s) => s.id)
          if (result.found) {
            setStore("instance", "session", result.index, reconcile(event.properties.info))
            break
          }
          setStore(
            "instance",
            "session",
            produce((draft) => {
              draft.splice(result.index, 0, event.properties.info)
            }),
          )
          break
        }

        case "session.next.moved": {
          const result = search(store.instance.session, event.properties.sessionID, (s) => s.id)
          if (!result.found) break
          setStore(
            "instance",
            "session",
            result.index,
            produce((session) => {
              session.directory = event.properties.location.directory
              session.path = event.properties.subdirectory
              session.workspaceID = event.properties.location.workspaceID
              session.time.updated = event.properties.timestamp
            }),
          )
          break
        }

        case "session.status": {
          setStore("instance", "session_status", event.properties.sessionID, event.properties.status)
          break
        }

        case "session.next.step.started": {
          setStore("instance", "session_status", event.properties.sessionID, { type: "busy" })
          break
        }

        case "session.next.step.ended": {
          setStore("instance", "session_status", event.properties.sessionID, { type: "idle" })
          break
        }

        case "session.next.retried": {
          setStore("instance", "session_status", event.properties.sessionID, {
            type: "retry",
            attempt: event.properties.attempt,
            message: event.properties.error.message,
            next: Date.now(),
          })
          break
        }

        case "session.next.failed": {
          setStore("instance", "session_status", event.properties.sessionID, { type: "idle" })
          break
        }

        case "lsp.updated": {
          debouncedLspStatus(project.workspace.current())
          break
        }

        case "vcs.branch.updated": {
          if (workspace === project.workspace.current()) {
            setStore("instance", "vcs", { branch: event.properties.branch })
          }
          break
        }
      }
    })
    onCleanup(unsubscribe)

    async function bootstrap(input: { fatal?: boolean } = {}) {
      const fatal = input.fatal ?? true
      const workspace = project.workspace.current()
      const boot = Date.now()
      mark("data bootstrap start", workspace)
      const projectPromise = project.sync()
      const sessionListPromise = projectPromise.then(() => listSessions())

      // blocking - include session.list when continuing a session
      const providersPromise = timed("providers", sdk.client.config.providers({ workspace }, { throwOnError: true }))
      const providerListPromise = timed("provider.list", sdk.client.provider.list({ workspace }, { throwOnError: true }))
      const agentsPromise = timed("agent.list", sdk.client.v2.agent.list({ location: { directory: workspace } }, { throwOnError: true }))
      const configPromise = timed("config.get", sdk.client.config.get({ workspace }, { throwOnError: true }))
      await Promise.all([
        providersPromise,
        providerListPromise,
        agentsPromise,
        configPromise,
        projectPromise,
        ...(args.continue ? [sessionListPromise] : []),
      ])
        .then(async () => {
          const providersResponse = providersPromise.then((x) => x.data!)
          const providerListResponse = providerListPromise.then((x) => x.data!)
          const agentsResponse = agentsPromise.then((x) => x.data?.data ?? [])
          const configResponse = configPromise.then((x) => x.data!)
          const sessionListResponse = args.continue ? sessionListPromise : undefined

          return Promise.all([
            providersResponse,
            providerListResponse,
            agentsResponse,
            configResponse,
            ...(sessionListResponse ? [sessionListResponse] : []),
          ]).then((responses) => {
            const providers = responses[0]
            const providerList = responses[1]
            const agents = responses[2]
            const config = responses[3]
            const sessions = responses[4]

            batch(() => {
              setStore("instance", "provider", reconcile(providers.providers))
              setStore("instance", "provider_default", reconcile(providers.default))
              setStore("instance", "provider_next", reconcile(providerList))
              setStore("instance", "agent", reconcile(agents))
              setStore("instance", "config", reconcile(config))
              if (sessions !== undefined) setStore("instance", "session", reconcile(sessions))
            })
          })
        })
        .then(() => {
          if (store.instance.status !== "complete") setStore("instance", "status", "partial")
          mark("data blocking done", `${Date.now() - boot}ms`)
          // non-blocking
          void Promise.all([
            ...(args.continue
              ? []
              : [sessionListPromise.then((sessions) => setStore("instance", "session", reconcile(sessions)))]),
            sdk.client.command.list({ workspace }).then((x) => setStore("instance", "command", reconcile(x.data ?? []))),
            sdk.client.lsp.status({ workspace }).then((x) => setStore("instance", "lsp", reconcile(x.data ?? []))),
            sdk.client.mcp.status({ workspace }).then((x) => setStore("instance", "mcp", reconcile(x.data ?? {}))),
            sdk.client.v2.reference
              .list({ location: { directory: workspace } })
              .then((x) => setStore("instance", "reference", reconcile(x.data?.data ?? []))),
            sdk.client.formatter.status({ workspace }).then((x) =>
              setStore("instance", "formatter", reconcile(x.data ?? [])),
            ),
            sdk.client.provider.auth({ workspace }).then((x) =>
              setStore("instance", "provider_auth", reconcile(x.data ?? {})),
            ),
            sdk.client.vcs.get({ workspace }).then((x) => setStore("instance", "vcs", reconcile(x.data))),
            project.workspace.sync(),
          ])
            .then(() => {
              setStore("instance", "status", "complete")
              mark("data complete", `${Date.now() - boot}ms`)
            })
            .catch((e) => {
              // Detached from the blocking chain; log so failures surface instead of rejecting unhandled.
              console.error("tui non-blocking sync failed", {
                error: e instanceof Error ? e.message : String(e),
              })
            })
        })
        .catch(async (e) => {
          console.error("tui bootstrap failed", {
            error: e instanceof Error ? e.message : String(e),
            name: e instanceof Error ? e.name : undefined,
            stack: e instanceof Error ? e.stack : undefined,
          })
          if (fatal) {
            exit(e)
          } else {
            throw e
          }
        })
    }

    onMount(() => {
      void bootstrap()
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
        // V1 session accessors (was sync.session.*)
        v1: {
          get(sessionID: string) {
            const match = search(store.instance.session, sessionID, (s) => s.id)
            if (match.found) return store.instance.session[match.index]
            return undefined
          },
          query() {
            return sessionListQuery()
          },
          async refresh() {
            const list = await listSessions()
            setStore("instance", "session", reconcile(list))
          },
          status(sessionID: string): SessionStatus {
            return store.instance.session_status[sessionID] ?? { type: "idle" }
          },
          async sync(sessionID: string) {
            const existing = syncingSessions.get(sessionID)
            if (existing) return existing
            const task = (async () => {
              const [sessionV2, messagesResponse, todo] = await Promise.all([
                sdk.client.v2.session.get({ sessionID }, { throwOnError: true }),
                // No throwOnError: a failed messages fetch must not crash sync, we
                // fall back to an empty history below (see #26560).
                sdk.client.v2.session.messages({ sessionID, limit: "100", order: "desc" }),
                sdk.client.v2.session.todo({ sessionID }),
              ])
              if (!sessionV2.data?.data) throw new Error(`Session ${sessionID} not found`)
              const v2Messages: SessionMessage[] = messagesResponse.data?.data ?? []
              setStore("session", "message", sessionID, v2Messages)
              setStore("session", "info", sessionID, sessionV2.data.data)
              const { messages, parts, status } = v1Projection(sessionID)
              const session = toV1Session(sessionV2.data.data)
              setStore(
                produce((draft) => {
                  const match = search(draft.instance.session, sessionID, (s) => s.id)
                  if (match.found) draft.instance.session[match.index] = session
                  if (!match.found) draft.instance.session.splice(match.index, 0, session)
                  draft.instance.todo[sessionID] = todo.data?.data ?? []
                  draft.instance.session_diff[sessionID] = []
                  draft.instance.session_status[sessionID] = status
                }),
              )
            })()
            syncingSessions.set(sessionID, task)
            task.finally(() => syncingSessions.delete(sessionID))
            return task
          },
        },
        list() {
          return store.instance.session
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
      // ------------------------------------------------------------------
      // Instance data (was sync.data) + derived V1 message projections.
      // ------------------------------------------------------------------
      instance: {
        get status() {
          return store.instance.status
        },
        get ready() {
          if (startup.skipInitialLoading) return true
          return store.instance.status !== "loading"
        },
        get provider() {
          return store.instance.provider
        },
        get provider_default() {
          return store.instance.provider_default
        },
        get provider_next() {
          return store.instance.provider_next
        },
        get provider_auth() {
          return store.instance.provider_auth
        },
        get config() {
          return store.instance.config
        },
        get agent() {
          return store.instance.agent
        },
        get command() {
          return store.instance.command
        },
        get lsp() {
          return store.instance.lsp
        },
        get mcp() {
          return store.instance.mcp
        },
        get reference() {
          return store.instance.reference
        },
        get formatter() {
          return store.instance.formatter
        },
        get vcs() {
          return store.instance.vcs
        },
        message(sessionID: string): Message[] {
          return v1Projection(sessionID).messages
        },
        part(messageID: string): Part[] | undefined {
          const sessionID = messageToSession.get(messageID)
          if (!sessionID) return undefined
          return v1Projection(sessionID).parts[messageID]
        },
        permission(sessionID: string): PermissionRequest[] {
          return store.instance.permission[sessionID] ?? []
        },
        question(sessionID: string): QuestionRequest[] {
          return store.instance.question[sessionID] ?? []
        },
        session_status(sessionID: string): SessionStatus {
          return store.instance.session_status[sessionID] ?? v1Projection(sessionID).status
        },
        session_diff(sessionID: string): SnapshotFileDiff[] {
          return store.instance.session_diff[sessionID] ?? []
        },
        todo(sessionID: string): Todo[] {
          return store.instance.todo[sessionID] ?? []
        },
        set<K extends keyof InstanceData>(path: K, value: InstanceData[K]) {
          setStore("instance", path, value as never)
        },
      },
      get status() {
        return store.instance.status
      },
      get ready() {
        if (startup.skipInitialLoading) return true
        return store.instance.status !== "loading"
      },
      get path() {
        return project.instance.path()
      },
      bootstrap,
    }

    return result
  },
})
