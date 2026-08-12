import type {
  SessionMessage,
  SessionMessageAssistant,
  SessionMessageAssistantTool,
  SessionMessageUser,
  SessionMessageSystem,
  SessionMessageSynthetic,
  SessionMessageShell,
  SessionInfo,
  SessionMessageCompaction,
  PromptFileAttachment,
  PromptAgentAttachment,
  Message,
  Part,
  TextPart,
  ReasoningPart,
  ToolPart,
  FilePart,
  AgentPart,
  CompactionPart,
  ToolState,
  UserMessage,
  AssistantMessage,
  SessionStatus,
} from "@opencode-ai/sdk/v2"

/**
 * Convert V2 SessionMessage[] (reverse-chrono, as stored by DataProvider)
 * into V1 Message.Info[] (chrono) + Part[] map + derived SessionStatus.
 *
 * This is the core of the V2->V1 bridge: V2 events update the DataProvider store,
 * this converter projects that into the V1 shapes the rendering code reads.
 */

// V2 stores messages newest-first (prepend/unshift). V1 expects oldest-first.
function toChrono(messages: SessionMessage[]): SessionMessage[] {
  return [...messages].reverse()
}

function parseToolInput(raw: string): Record<string, unknown> {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

function convertToolState(
  tool: SessionMessageAssistantTool,
  sessionID: string,
  messageID: string,
): ToolState {
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
    const output =
      typeof result === "string"
        ? result
        : result != null
          ? JSON.stringify(result)
          : ""
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
  // error
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

function convertAssistantContent(
  msg: SessionMessageAssistant,
  sessionID: string,
): Part[] {
  const parts: Part[] = []
  for (const content of msg.content) {
    if (content.type === "text") {
      const part: TextPart = {
        id: `prt_${content.id}`,
        sessionID,
        messageID: msg.id,
        type: "text",
        text: content.text,
        time: { start: msg.time.created },
      }
      parts.push(part)
    } else if (content.type === "reasoning") {
      const part: ReasoningPart = {
        id: `prt_${content.id}`,
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
        id: `prt_${content.id}`,
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

type ModelRef = { providerID: string; modelID: string; variant?: string }

function convertUserMessage(
  msg: SessionMessageUser | SessionMessageSystem | SessionMessageSynthetic,
  sessionID: string,
  agent: string,
  model: ModelRef,
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

  // File parts (only for real user messages)
  if (msg.type === "user" && msg.files) {
    for (const file of msg.files as PromptFileAttachment[]) {
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

  // Agent parts (only for real user messages)
  if (msg.type === "user" && msg.agents) {
    for (const agentAtt of msg.agents as PromptAgentAttachment[]) {
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
  model: ModelRef,
): { info: UserMessage; parts: Part[] } {
  const text = `$ ${msg.command}\n${msg.output}`
  const part: TextPart = {
    id: `prt_${msg.id}_shell`,
    sessionID,
    messageID: msg.id,
    type: "text",
    text,
    synthetic: true,
    time: {
      start: msg.time.created,
      ...(msg.time.completed ? { end: msg.time.completed } : {}),
    },
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

  return { info, parts: [part] }
}

function convertAssistantMessage(
  msg: SessionMessageAssistant,
  sessionID: string,
  parentID: string,
): { info: AssistantMessage; parts: Part[] } {
  const parts = convertAssistantContent(msg, sessionID)

  const info: AssistantMessage = {
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
  }

  return { info, parts }
}

function convertCompactionMessage(
  msg: SessionMessageCompaction,
  sessionID: string,
  parentID: string,
  agent: string,
  model: ModelRef,
): { info: AssistantMessage; parts: Part[] } {
  const part: CompactionPart = {
    id: `prt_${msg.id}_compaction`,
    sessionID,
    messageID: msg.id,
    type: "compaction",
    auto: msg.reason === "auto",
  }

  const info: AssistantMessage = {
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
  }

  return { info, parts: [part] }
}

function deriveStatus(messages: SessionMessage[]): SessionStatus {
  if (messages.length === 0) return { type: "idle" }
  // messages are reverse-chrono; first element is newest
  const latest = messages[0]
  if (latest.type === "assistant") {
    if (latest.time.completed) return { type: "idle" }
    return { type: "busy" }
  }
  if (latest.type === "user" || latest.type === "shell" || latest.type === "system" || latest.type === "synthetic") {
    return { type: "busy" }
  }
  // agent-switched, model-switched, skill, compaction - check next
  if (messages.length > 1) {
    const next = messages[1]
    if (next.type === "assistant" && !next.time.completed) return { type: "busy" }
    if (next.type === "user" || next.type === "shell") return { type: "busy" }
  }
  return { type: "idle" }
}

export function convertV2Messages(
  sessionID: string,
  v2Messages: SessionMessage[],
  sessionInfo?: SessionInfo,
): {
  messages: Message[]
  parts: Record<string, Part[]>
  status: SessionStatus
} {
  const agent = sessionInfo?.agent ?? "build"
  const model: ModelRef = sessionInfo?.model
    ? { providerID: sessionInfo.model.providerID, modelID: sessionInfo.model.id, variant: sessionInfo.model.variant }
    : { providerID: "anthropic", modelID: "claude-sonnet-4-20250514" }

  const chrono = toChrono(v2Messages)
  const messages: Message[] = []
  const parts: Record<string, Part[]> = {}
  let lastUserID = ""

  for (const msg of chrono) {
    if (msg.type === "user" || msg.type === "system" || msg.type === "synthetic") {
      const { info, parts: msgParts } = convertUserMessage(msg, sessionID, agent, model, msg.type !== "user")
      messages.push(info)
      parts[info.id] = msgParts
      lastUserID = info.id
    } else if (msg.type === "shell") {
      const { info, parts: msgParts } = convertShellMessage(msg, sessionID, agent, model)
      messages.push(info)
      parts[info.id] = msgParts
      lastUserID = info.id
    } else if (msg.type === "assistant") {
      const { info, parts: msgParts } = convertAssistantMessage(msg, sessionID, lastUserID || msg.id)
      messages.push(info)
      parts[info.id] = msgParts
    } else if (msg.type === "compaction") {
      const { info, parts: msgParts } = convertCompactionMessage(msg, sessionID, lastUserID || msg.id, agent, model)
      messages.push(info)
      parts[info.id] = msgParts
    }
    // agent-switched, model-switched, skill: skip (no V1 equivalent in message list)
  }

  return {
    messages,
    parts,
    status: deriveStatus(v2Messages),
  }
}
