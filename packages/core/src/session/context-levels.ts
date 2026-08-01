export * as ContextLevels from "./context-levels"

import { Message, ToolResultValue, type ContentPart, type LLMRequest, type ToolContent } from "@opencode-ai/llm"
import { Token } from "../util/token"

// ─── Defaults ───────────────────────────────────────────────────────────────

const DEFAULT_L2_TRIGGER = 0.55
const DEFAULT_L3_TRIGGER = 0.7
const DEFAULT_L4_TRIGGER = 0.85
const DEFAULT_L5_TRIGGER = 0.95
const DEFAULT_L1_MAX_CHARS = 8_000

// ─── Level Descriptor ───────────────────────────────────────────────────────

export type Level = 1 | 2 | 3 | 4 | 5

export type LevelConfig = {
  readonly l2_trigger: number
  readonly l3_trigger: number
  readonly l4_trigger: number
  readonly l5_trigger: number
  readonly l1_max_chars: number
}

export const defaultLevelConfig = (): LevelConfig => ({
  l2_trigger: DEFAULT_L2_TRIGGER,
  l3_trigger: DEFAULT_L3_TRIGGER,
  l4_trigger: DEFAULT_L4_TRIGGER,
  l5_trigger: DEFAULT_L5_TRIGGER,
  l1_max_chars: DEFAULT_L1_MAX_CHARS,
})

// ─── L1 — Tool Output Truncation ────────────────────────────────────────────

const toolResultText = (value: unknown): string => {
  if (typeof value === "string") return value
  try {
    return JSON.stringify(value) ?? String(value)
  } catch {
    return String(value)
  }
}

const truncateToolResultValue = (result: ToolResultValue, maxChars: number): ToolResultValue => {
  if (result.type === "text") {
    const text = toolResultText(result.value)
    if (text.length <= maxChars) return result
    return { type: "text", value: `${text.slice(0, maxChars)}\n[truncated]` }
  }
  if (result.type === "content") {
    let truncated = false
    const content = result.value.flatMap((item: ToolContent): ToolContent[] => {
      if (item.type !== "text") return [item]
      if (item.text.length <= maxChars) return [item]
      truncated = true
      return [{ ...item, text: `${item.text.slice(0, maxChars)}\n[truncated]` }]
    })
    if (!truncated) return result
    return { type: "content", value: content }
  }
  return result
}

const truncateContentPart = (part: ContentPart, maxChars: number): ContentPart => {
  if (part.type !== "tool-result") return part
  const truncated = truncateToolResultValue(part.result, maxChars)
  if (truncated === part.result) return part
  return { ...part, result: truncated }
}

/** L1: Truncate oversized tool results in LLM messages. Always active. Immutable. */
export const truncateToolOutputs = (messages: readonly Message[], maxChars: number): Message[] => {
  if (maxChars <= 0) return [...messages]
  return messages.map((msg) => {
    const hasToolResult = msg.content.some((part) => part.type === "tool-result")
    if (!hasToolResult) return msg
    const newContent = msg.content.map((part) => truncateContentPart(part, maxChars))
    return Message.make({ id: msg.id, role: msg.role, content: newContent, metadata: msg.metadata })
  })
}

// ─── L2 — Snip Compact ──────────────────────────────────────────────────────

/** Check if `index` is a safe split point (after a complete turn, never mid-tool-exchange). */
const canSplitAfter = (messages: readonly Message[], index: number): boolean => {
  if (index < 0 || index >= messages.length) return false
  const msg = messages[index]
  // Safe to split after user or assistant messages
  if (msg.role === "user" || msg.role === "assistant") {
    // Ensure no pending tool results follow immediately
    const next = messages[index + 1]
    if (!next) return true
    // If next message is a tool-role message, we're mid-tool-exchange
    if (next.role === "tool") return false
    return true
  }
  // After a tool message, check if more tool results follow
  if (msg.role === "tool") {
    const next = messages[index + 1]
    if (!next) return true
    // More tool results in the same group
    if (next.role === "tool") return false
    return true
  }
  return false
}

/** L2: Drop oldest messages to fit within keepTokens budget. Respects tool boundaries. */
export const snipCompact = (
  messages: readonly Message[],
  keepTokens: number,
): Message[] => {
  if (messages.length === 0) return []
  // Walk backward, accumulating tokens
  let accumulated = 0
  let splitIndex = 0
  for (let i = messages.length - 1; i >= 0; i--) {
    const estimated = Token.estimate(JSON.stringify(messages[i]))
    if (accumulated + estimated > keepTokens) {
      // Find the next valid split point after i
      splitIndex = i + 1
      break
    }
    accumulated += estimated
    splitIndex = i
  }
  // Advance splitIndex to a valid split point
  while (splitIndex < messages.length && !canSplitAfter(messages, splitIndex)) {
    splitIndex++
  }
  if (splitIndex >= messages.length) return []
  return messages.slice(splitIndex)
}

// ─── L3 — Microcompact ──────────────────────────────────────────────────────

const FILE_TOOL_NAMES = new Set([
  "file_write",
  "file_edit",
  "write_file",
  "edit_file",
  "create_file",
  "file_create",
  "write",
  "edit",
  "fileWrite",
  "fileEdit",
])

const extractFilePath = (name: string, input: unknown): string | undefined => {
  if (!FILE_TOOL_NAMES.has(name)) return undefined
  if (typeof input === "object" && input !== null && "file_path" in input) {
    const path = (input as Record<string, unknown>).file_path
    if (typeof path === "string") return path
  }
  if (typeof input === "object" && input !== null && "path" in input) {
    const path = (input as Record<string, unknown>).path
    if (typeof path === "string") return path
  }
  return undefined
}

/** L3: Deduplicate repeated file edits — keep only the final edit per file.
 *  Removes intermediate edit assistant messages AND their corresponding tool result
 *  messages to preserve tool-call/response pairing. Replaces each removed group with
 *  a single user message containing a note. */
export const microcompact = (messages: readonly Message[]): Message[] => {
  // First pass: identify all tool calls that edit files and track which is the last edit per file
  const fileEdits = new Map<string, number[]>()
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]
    if (msg.role !== "assistant") continue
    for (const part of msg.content) {
      if (part.type !== "tool-call") continue
      const filePath = extractFilePath(part.name, part.input)
      if (!filePath) continue
      const indices = fileEdits.get(filePath)
      if (indices) indices.push(i)
      else fileEdits.set(filePath, [i])
    }
  }

  // Collect message indices that are intermediate edits (not the last one for their file)
  const intermediateEditIndices = new Set<number>()
  for (const indices of fileEdits.values()) {
    if (indices.length <= 1) continue
    // All but the last are intermediate
    for (let i = 0; i < indices.length - 1; i++) {
      intermediateEditIndices.add(indices[i])
    }
  }

  if (intermediateEditIndices.size === 0) return [...messages]

  // Collect tool-call IDs from intermediate edits so we can remove their tool results
  const orphanedToolCallIDs = new Set<string>()
  for (const index of intermediateEditIndices) {
    const msg = messages[index]
    for (const part of msg.content) {
      if (part.type !== "tool-call") continue
      const filePath = extractFilePath(part.name, part.input)
      if (filePath && fileEdits.get(filePath)!.length > 1) orphanedToolCallIDs.add(part.id)
    }
  }

  // Second pass: remove intermediate edit messages and their tool results,
  // replacing each intermediate edit with a user note message
  const result: Message[] = []
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]
    // Skip tool result messages that correspond to removed intermediate edits
    if (msg.role === "tool") {
      const hasOrphanedResult = msg.content.some(
        (part) => part.type === "tool-result" && orphanedToolCallIDs.has(part.id),
      )
      if (hasOrphanedResult) continue
      result.push(msg)
      continue
    }
    if (!intermediateEditIndices.has(i)) {
      result.push(msg)
      continue
    }
    // Find which files were edited in this message
    const editedFiles: string[] = []
    for (const part of msg.content) {
      if (part.type !== "tool-call") continue
      const filePath = extractFilePath(part.name, part.input)
      if (filePath && fileEdits.get(filePath)!.length > 1) editedFiles.push(filePath)
    }
    if (editedFiles.length === 0) {
      result.push(msg)
      continue
    }
    const note = editedFiles.map((f) => `[previous edit of ${f} — see final version above]`).join("\n")
    result.push(Message.make({
      id: msg.id,
      role: "user",
      content: [{ type: "text", text: note }],
    }))
  }
  return result
}

// ─── Context Usage Estimation ───────────────────────────────────────────────

/** Determine which degradation level is needed given current context usage ratio. */
export const computeLevel = (usageRatio: number, config: LevelConfig): Level => {
  if (usageRatio >= config.l5_trigger) return 5
  if (usageRatio >= config.l4_trigger) return 4
  if (usageRatio >= config.l3_trigger) return 3
  if (usageRatio >= config.l2_trigger) return 2
  return 1
}
