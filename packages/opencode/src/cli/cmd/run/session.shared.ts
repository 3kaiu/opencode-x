// Session message extraction and prompt history.
//
// Fetches session messages from the SDK and converts the V2 projection into
// the legacy message row shape the run UI was built against. Also finds the
// most recently used variant for the current model so the footer can
// pre-select it.
import type {
  SessionMessage,
  SessionMessageAssistant,
  SessionMessageAssistantTool,
  SessionMessageCompaction,
  SessionMessageShell,
  SessionMessageSynthetic,
  SessionMessageSystem,
  SessionMessageUser,
  Message,
  Part,
  UserMessage,
  AssistantMessage,
  TextPart,
  ReasoningPart,
  ToolPart,
  FilePart,
  AgentPart,
  CompactionPart,
  ToolState,
} from "@opencode-ai/sdk/v2"
import { promptCopy, promptSame } from "./prompt.shared"
import type { RunInput, RunPrompt } from "./types"

const LIMIT = 200

type SessionModel = {
  providerID: string
  modelID: string
  variant?: string
}

export type SessionMessages = Array<{
  info: Message
  parts: Part[]
}>

type Turn = {
  prompt: RunPrompt
  provider: string | undefined
  model: string | undefined
  variant: string | undefined
}

export type RunSession = {
  first: boolean
  turns: Turn[]
}

function parseToolInput(raw: string): Record<string, unknown> {
  if (!raw) {
    return {}
  }

  try {
    const parsed = JSON.parse(raw)
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

function convertToolState(tool: SessionMessageAssistantTool, sessionID: string, messageID: string): ToolState {
  const state = tool.state
  if (state.status === "pending") {
    return {
      status: "pending",
      input: parseToolInput(state.input),
      raw: state.input,
    }
  }

  if (state.status === "running") {
    return {
      status: "running",
      input: state.input,
      title: typeof state.structured.title === "string" ? state.structured.title : "",
      metadata: state.structured,
      time: { start: tool.time.ran ?? tool.time.created },
    }
  }

  if (state.status === "completed") {
    const result = state.result
    const output = typeof result === "string" ? result : result != null ? JSON.stringify(result) : ""
    return {
      status: "completed",
      input: state.input,
      output,
      title: typeof state.structured.title === "string" ? state.structured.title : "",
      metadata: state.structured,
      time: {
        start: tool.time.created,
        end: tool.time.completed ?? tool.time.created,
      },
      ...(state.attachments
        ? {
            attachments: state.attachments.map((file) => ({
              id: `prt_${tool.id}_att_${file.uri}`,
              sessionID,
              messageID,
              type: "file" as const,
              mime: file.mime ?? "application/octet-stream",
              url: file.uri,
              ...(file.name ? { filename: file.name } : {}),
            })),
          }
        : {}),
    }
  }

  return {
    status: "error",
    input: state.input,
    error: state.error.message,
    metadata: state.structured,
    time: {
      start: tool.time.created,
      end: tool.time.completed ?? tool.time.created,
    },
  }
}

function convertAssistantContent(msg: SessionMessageAssistant, sessionID: string): Part[] {
  const parts: Part[] = []

  for (const content of msg.content) {
    if (content.type === "text") {
      const part: TextPart = {
        id: content.id,
        sessionID,
        messageID: msg.id,
        type: "text",
        text: content.text,
        time: { start: msg.time.created },
      }
      parts.push(part)
    } else if (content.type === "reasoning") {
      const part: ReasoningPart = {
        id: content.id,
        sessionID,
        messageID: msg.id,
        type: "reasoning",
        text: content.text,
        time: {
          start: content.time?.created ?? msg.time.created,
          ...(content.time?.completed ? { end: content.time.completed } : {}),
        },
      }
      parts.push(part)
    } else if (content.type === "tool") {
      const part: ToolPart = {
        id: content.id,
        sessionID,
        messageID: msg.id,
        type: "tool",
        callID: content.id,
        tool: content.name,
        state: convertToolState(content, sessionID, msg.id),
      }
      parts.push(part)
    }
  }

  return parts
}

function convertUserMessage(
  msg: SessionMessageUser | SessionMessageSystem | SessionMessageSynthetic,
  sessionID: string,
  agent: string,
  model: SessionModel,
  synthetic?: boolean,
): { info: UserMessage; parts: Part[] } {
  const parts: Part[] = []

  const textPart: TextPart = {
    id: `prt_${msg.id}_text`,
    sessionID,
    messageID: msg.id,
    type: "text",
    text: msg.text,
    ...(synthetic ? { synthetic: true } : {}),
    time: { start: msg.time.created },
  }
  parts.push(textPart)

  if (msg.type === "user" && msg.files) {
    for (const file of msg.files) {
      const part: FilePart = {
        id: `prt_${msg.id}_file_${file.uri}`,
        sessionID,
        messageID: msg.id,
        type: "file",
        mime: file.mime ?? "application/octet-stream",
        url: file.uri,
        ...(file.name ? { filename: file.name } : {}),
      }
      parts.push(part)
    }
  }

  if (msg.type === "user" && msg.agents) {
    for (const agentAtt of msg.agents) {
      const part: AgentPart = {
        id: `prt_${msg.id}_agent_${agentAtt.name}`,
        sessionID,
        messageID: msg.id,
        type: "agent",
        name: agentAtt.name,
      }
      parts.push(part)
    }
  }

  const info: UserMessage = {
    id: msg.id,
    sessionID,
    role: "user",
    time: { created: msg.time.created },
    agent,
    model: {
      providerID: model.providerID,
      modelID: model.modelID,
      ...(model.variant ? { variant: model.variant } : {}),
    },
  }

  return { info, parts }
}

function convertShellMessage(
  msg: SessionMessageShell,
  sessionID: string,
  agent: string,
  model: SessionModel,
): { info: UserMessage; parts: Part[] } {
  const part: TextPart = {
    id: `prt_${msg.id}_shell`,
    sessionID,
    messageID: msg.id,
    type: "text",
    text: `$ ${msg.command}\n${msg.output}`,
    synthetic: true,
    time: {
      start: msg.time.created,
      ...(msg.time.completed ? { end: msg.time.completed } : {}),
    },
  }

  return {
    info: {
      id: msg.id,
      sessionID,
      role: "user",
      time: { created: msg.time.created },
      agent,
      model: {
        providerID: model.providerID,
        modelID: model.modelID,
        ...(model.variant ? { variant: model.variant } : {}),
      },
    },
    parts: [part],
  }
}

function convertAssistantMessage(
  msg: SessionMessageAssistant,
  sessionID: string,
  parentID: string,
): { info: AssistantMessage; parts: Part[] } {
  return {
    info: {
      id: msg.id,
      sessionID,
      role: "assistant",
      time: {
        created: msg.time.created,
        ...(msg.time.completed ? { completed: msg.time.completed } : {}),
      },
      parentID,
      modelID: msg.model.id,
      providerID: msg.model.providerID,
      ...(msg.model.variant ? { variant: msg.model.variant } : {}),
      mode: "normal",
      agent: msg.agent,
      path: { cwd: "", root: "" },
      cost: msg.cost ?? 0,
      tokens: msg.tokens ?? { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      ...(msg.finish ? { finish: msg.finish } : {}),
      ...(msg.error
        ? { error: { name: "UnknownError", data: { message: msg.error.message } } as AssistantMessage["error"] }
        : {}),
    },
    parts: convertAssistantContent(msg, sessionID),
  }
}

function convertCompactionMessage(
  msg: SessionMessageCompaction,
  sessionID: string,
  parentID: string,
  agent: string,
  model: SessionModel,
): { info: AssistantMessage; parts: Part[] } {
  const part: CompactionPart = {
    id: `prt_${msg.id}_compaction`,
    sessionID,
    messageID: msg.id,
    type: "compaction",
    auto: msg.reason === "auto",
  }

  return {
    info: {
      id: msg.id,
      sessionID,
      role: "assistant",
      time: { created: msg.time.created },
      parentID,
      modelID: model.modelID,
      providerID: model.providerID,
      ...(model.variant ? { variant: model.variant } : {}),
      mode: "normal",
      agent,
      path: { cwd: "", root: "" },
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      finish: "compaction",
    },
    parts: [part],
  }
}

// Convert the V2 session message projection into the legacy message row
// shape the run UI reads. The input must already be in chronological order.
export function convertV2Messages(
  sessionID: string,
  v2Messages: SessionMessage[],
  agent = "build",
  model: SessionModel = { providerID: "", modelID: "" },
): SessionMessages {
  const out: SessionMessages = []
  let lastUserID = ""

  for (const msg of v2Messages) {
    if (msg.type === "user" || msg.type === "system" || msg.type === "synthetic") {
      const { info, parts } = convertUserMessage(msg, sessionID, agent, model, msg.type !== "user")
      out.push({ info, parts })
      lastUserID = info.id
    } else if (msg.type === "shell") {
      const { info, parts } = convertShellMessage(msg, sessionID, agent, model)
      out.push({ info, parts })
      lastUserID = info.id
    } else if (msg.type === "assistant") {
      const { info, parts } = convertAssistantMessage(msg, sessionID, lastUserID || msg.id)
      out.push({ info, parts })
    } else if (msg.type === "compaction") {
      const { info, parts } = convertCompactionMessage(msg, sessionID, lastUserID || msg.id, agent, model)
      out.push({ info, parts })
    }
    // agent-switched, model-switched, skill: skip (no legacy equivalent)
  }

  return out
}

function fileName(url: string, filename?: string) {
  if (filename) {
    return filename
  }

  try {
    const next = new URL(url)
    if (next.protocol !== "file:") {
      return url
    }

    const name = next.pathname.split("/").at(-1)
    if (name) {
      return decodeURIComponent(name)
    }
  } catch {}

  return url
}

function fileSource(
  part: Extract<SessionMessages[number]["parts"][number], { type: "file" }>,
  text: { start: number; end: number; value: string },
) {
  if (part.source) {
    return {
      ...structuredClone(part.source),
      text,
    }
  }

  return {
    type: "file" as const,
    path: part.filename ?? part.url,
    text,
  }
}

export function messagePrompt(msg: SessionMessages[number]): RunPrompt {
  const parts: RunPrompt["parts"] = []
  let text = msg.parts
    .filter((part): part is Extract<SessionMessages[number]["parts"][number], { type: "text" }> => {
      return part.type === "text" && !part.synthetic
    })
    .map((part) => part.text)
    .join("")
  let cursor = Bun.stringWidth(text)
  const used: Array<{ start: number; end: number }> = []

  const take = (value: string): { start: number; end: number; value: string } | undefined => {
    let from = 0
    while (true) {
      const idx = text.indexOf(value, from)
      if (idx === -1) {
        return undefined
      }

      const start = Bun.stringWidth(text.slice(0, idx))
      const end = start + Bun.stringWidth(value)
      if (!used.some((item) => item.start < end && start < item.end)) {
        return { start, end, value }
      }

      from = idx + value.length
    }
  }

  const add = (value: string) => {
    const gap = text ? " " : ""
    const start = cursor + Bun.stringWidth(gap)
    text += gap + value
    const end = start + Bun.stringWidth(value)
    cursor = end
    return { start, end, value }
  }

  for (const part of msg.parts) {
    if (part.type === "file") {
      const next = part.source?.text ? structuredClone(part.source.text) : take("@" + fileName(part.url, part.filename))
      const span = next ?? add("@" + fileName(part.url, part.filename))
      used.push({ start: span.start, end: span.end })
      parts.push({
        type: "file",
        mime: part.mime,
        filename: part.filename,
        url: part.url,
        source: fileSource(part, span),
      })
      continue
    }

    if (part.type !== "agent") {
      continue
    }

    const span = part.source ? structuredClone(part.source) : (take("@" + part.name) ?? add("@" + part.name))
    used.push({ start: span.start, end: span.end })
    parts.push({
      type: "agent",
      name: part.name,
      source: span,
    })
  }

  return { text, parts }
}

function turn(msg: SessionMessages[number]): Turn | undefined {
  if (msg.info.role !== "user") {
    return undefined
  }

  return {
    prompt: messagePrompt(msg),
    provider: msg.info.model.providerID,
    model: msg.info.model.modelID,
    variant: msg.info.model.variant,
  }
}

export function createSession(messages: SessionMessages): RunSession {
  return {
    first: messages.length === 0,
    turns: messages.flatMap((msg) => {
      const item = turn(msg)
      return item ? [item] : []
    }),
  }
}

export async function resolveSession(sdk: RunInput["sdk"], sessionID: string, limit = LIMIT): Promise<RunSession> {
  const [session, response] = await Promise.all([
    sdk.v2.session.get({ sessionID }).catch(() => undefined),
    sdk.v2.session.messages({ sessionID, limit: String(limit), order: "asc" }).catch(() => undefined),
  ])

  const info = session?.data?.data
  if (!info && !response) {
    return { first: true, turns: [] }
  }

  return createSession(
    convertV2Messages(
      sessionID,
      response?.data?.data ?? [],
      info?.agent,
      info?.model ? { providerID: info.model.providerID, modelID: info.model.id, variant: info.model.variant } : undefined,
    ),
  )
}

export function sessionHistory(session: RunSession, limit = LIMIT): RunPrompt[] {
  const out: RunPrompt[] = []

  for (const turn of session.turns) {
    if (!turn.prompt.text.trim()) {
      continue
    }

    if (out[out.length - 1] && promptSame(out[out.length - 1], turn.prompt)) {
      continue
    }

    out.push(promptCopy(turn.prompt))
  }

  return out.slice(-limit)
}

export function sessionVariant(session: RunSession, model: RunInput["model"]): string | undefined {
  if (!model) {
    return undefined
  }

  for (let idx = session.turns.length - 1; idx >= 0; idx -= 1) {
    const turn = session.turns[idx]
    if (turn.provider !== model.providerID || turn.model !== model.modelID) {
      continue
    }

    return turn.variant
  }

  return undefined
}