// V2 compaction algorithms (M1 §1.6).
// Ports of pi `findCutPoint` + incremental UPDATE summary + kimi-code
// real-user-message whitelist + head/tail segmentation.
export * as CompactionAlgo from "./compaction-algorithms"

export interface CompactableMessage {
  readonly seq: number
  readonly role: "user" | "assistant" | "system"
  readonly isToolResult?: boolean
  readonly isMetadata?: boolean
  readonly isUserMessage?: boolean      // true = real user/skill-activation input (whitelisted)
  readonly tokenEstimate: number
  readonly text: string
}

export interface CutResult {
  readonly messagesToSummarize: ReadonlyArray<CompactableMessage>
  readonly retainedTail: ReadonlyArray<CompactableMessage>
  readonly cutSeq: number              // first retained seq
  readonly turnSplit: boolean          // cut landed inside a turn; prefix messages joined into summary
}

/**
 * pi `findCutPoint`: walk backwards from the tail accumulating estimated
 * tokens until `keepRecentTokens` is reached; pick the nearest legal cut point
 * (never a toolResult or metadata entry). If the cut lands inside a turn (not
 * at a user message), rewind to the turn start so the split is turn-aligned.
 */
export function findCutPoint(
  messages: ReadonlyArray<CompactableMessage>,
  keepRecentTokens: number,
): CutResult {
  let acc = 0
  let cut = messages.length
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m.isToolResult || m.isMetadata) continue       // never cut here
    acc += m.tokenEstimate
    if (acc >= keepRecentTokens) {
      cut = i
      break
    }
  }
  // Legal cut: prefer a user message; otherwise rewind to the start of the turn.
  let turnPrefix: CompactableMessage[] = []
  let messagesToSummarize = messages.slice(0, cut)
  const retainedTail = messages.slice(cut)
  let turnSplit = false
  if (cut > 0 && cut < messages.length) {
    const cutMessage = messages[cut]
    if (cutMessage.role !== "user") {
      // rewind to turn start (nearest user message at or before cut)
      let turnStart = cut
      while (turnStart > 0 && messages[turnStart - 1].role !== "user") turnStart--
      if (turnStart < cut) {
        turnPrefix = messages.slice(turnStart, cut)
        messagesToSummarize = messages.slice(0, turnStart)
        turnSplit = true
      }
    }
  }
  return {
    messagesToSummarize,
    retainedTail: [...turnPrefix, ...retainedTail],
    cutSeq: retainedTail[0]?.seq ?? -1,
    turnSplit,
  }
}

/**
 * kimi-code head/tail segmentation for oversized user messages: keep the
 * earliest head (original task statement) + latest tail; elide the middle.
 */
export function segmentOversizedMessage(
  message: CompactableMessage,
  maxTokens: number,
  headTokens = 2_000,
): { readonly text: string; readonly elidedTokens: number } {
  const charsPerToken = 4
  const maxChars = maxTokens * charsPerToken
  if (message.tokenEstimate <= maxTokens) return { text: message.text, elidedTokens: 0 }
  const headChars = headTokens * charsPerToken
  const tailChars = maxChars - headChars
  const elided = message.text.length - headChars - tailChars
  return {
    text: `${message.text.slice(0, headChars)}\n<system-reminder>${elided} chars elided</system-reminder>\n${message.text.slice(-tailChars)}`,
    elidedTokens: Math.ceil(elided / charsPerToken),
  }
}

/**
 * Real-user-message whitelist (kimi PromptOrigin classification):
 * user and skill-activation prompts are retained verbatim; injected/background
 * inputs are eligible for summary replacement.
 */
export function isWhitelistedUserMessage(message: CompactableMessage): boolean {
  return message.role === "user" && (message.isUserMessage === true || message.isUserMessage === undefined)
}

export interface SummaryTemplate {
  readonly objective: string
  readonly progress: { readonly done: ReadonlyArray<string>; readonly inProgress: ReadonlyArray<string>; readonly blocked: ReadonlyArray<string> }
  readonly keyDecisions: ReadonlyArray<{ readonly decision: string; readonly reason: string }>
  readonly nextSteps: ReadonlyArray<string>
  readonly criticalContext: string
  readonly fileOps: { readonly readFiles: ReadonlyArray<string>; readonly modifiedFiles: ReadonlyArray<string> }
  readonly supersedes: number | null    // seq of the summary being updated (null = fresh)
}

const SUMMARY_SECTIONS: ReadonlyArray<keyof SummaryTemplate> = [
  "objective", "progress", "keyDecisions", "nextSteps", "criticalContext", "fileOps",
]

/**
 * Compose the summary prompt. `mode: "update"` produces an UPDATE variant that
 * references the previous summary — the model increments rather than rewrites
 * (pi incremental UPDATE summary; keeps token cost low and context stable).
 */
export function buildSummaryPrompt(previous: SummaryTemplate | null, messagesText: string): string {
  if (previous === null) {
    return [
      "Summarize the conversation into a decision-focused handoff note for yourself.",
      "Cover: objective (the original task), progress (done/in-progress/blocked),",
      "key decisions with reasons, next steps, critical context (paths/commands/conventions),",
      "and file operations. Write in first person as the agent continuing this work.",
      "",
      "CONVERSATION:",
      messagesText,
    ].join("\n")
  }
  return [
    "Update the previous handoff note with the new conversation segment.",
    "Preserve decisions and context that still hold; amend progress and next steps.",
    "Do not rewrite the whole note.",
    "",
    "PREVIOUS NOTE:",
    JSON.stringify(previous, null, 2),
    "",
    "NEW CONVERSATION:",
    messagesText,
  ].join("\n")
}

/** Scans messages for file operations (pi formatFileOperations): read/edit paths. */
export function collectFileOps(messages: ReadonlyArray<CompactableMessage>): {
  readonly readFiles: ReadonlyArray<string>
  readonly modifiedFiles: ReadonlyArray<string>
} {
  const readFiles = new Set<string>()
  const modifiedFiles = new Set<string>()
  for (const m of messages) {
    const read = m.text.match(/(?:read|cat|less)\s+["']?([^\s"']+\.(?:ts|tsx|js|jsx|json|md|go|rs|py|c|h|css|html))["']?/g)
    read?.forEach((hit) => readFiles.add(hit.split(/\s+/).pop()!))
    const mod = m.text.match(/(?:edit|write|apply_patch)\s+(?:file\s+)?["']?([^\s"']+\.(?:ts|tsx|js|jsx|json|md|go|rs|py|c|h|css|html))["']?/g)
    mod?.forEach((hit) => modifiedFiles.add(hit.split(/\s+/).pop()!))
  }
  return { readFiles: [...readFiles], modifiedFiles: [...modifiedFiles] }
}

export const SUMMARY_SECTION_ORDER = SUMMARY_SECTIONS
