export * as SessionCompaction from "./compaction"

import { LLM, LLMError, LLMEvent, LLMRequest, Message, type Model } from "@opencode-ai/llm"
import { DateTime, Effect, Stream } from "effect"
import type { Config } from "../../config"
import type { EventV2 } from "../../event"
import { SessionEvent } from "../../session/event"
import { SessionMessage } from "../../session/message"
import { SessionSchema } from "../../session/schema"
import { Token } from "../../util/token"
import { ContextLevels } from "./context-levels"

const DEFAULT_BUFFER = 20_000
const DEFAULT_KEEP_TOKENS = 8_000
const TOOL_OUTPUT_MAX_CHARS = 2_000
const SUMMARY_OUTPUT_TOKENS = 4_096
const SUMMARY_TEMPLATE = `Output exactly the Markdown structure shown inside <template> and keep the section order unchanged. Do not include the <template> tags in your response.
<template>
## Objective
- [one or two brief sentences describing what the user is trying to accomplish]

## Important Details
- [constraints/preferences, decisions and why, important facts/assumptions, exact context needed to continue, or "(none)"]

## Work State
### Completed
- [finished work, verified facts, or changes made; otherwise "(none)"]

### Active
- [current work, partial changes, or investigation state; otherwise "(none)"]

### Blocked
- [blockers, failing commands, or unknowns; otherwise "(none)"]

## Next Move
1. [immediate concrete action, or "(none)"]
2. [next action if known, or "(none)"]

## Relevant Files
- [file or directory path: why it matters, or "(none)"]
</template>

Rules:
- Keep every section, even when empty.
- Use terse bullets, not prose paragraphs.
- Preserve exact file paths, symbols, commands, error strings, URLs, and identifiers when known.
- Do not mention the summary process or that context was compacted.`

type Entry = {
  readonly seq: number
  readonly message: SessionMessage.Message
}

type Settings = {
  readonly auto: boolean
  readonly buffer: number
  readonly tokens: number
  readonly levels: ContextLevels.LevelConfig
}

type Dependencies = {
  readonly events: EventV2.Interface
  readonly llm: {
    readonly stream: (request: LLMRequest) => Stream.Stream<LLMEvent, LLMError>
  }
  readonly config: readonly Config.Entry[]
}

type Input = {
  readonly sessionID: SessionSchema.ID
  readonly entries: readonly Entry[]
  readonly model: Model
  readonly request: LLMRequest
}

type ManualInput = {
  readonly sessionID: SessionSchema.ID
  readonly entries: readonly Entry[]
  readonly model: Model
  readonly instructions?: string
}

type SummarizeInput = {
  readonly sessionID: SessionSchema.ID
  readonly entries: readonly Entry[]
  readonly model: Model
  readonly output: number
  readonly reason: "auto" | "manual"
  readonly instructions?: string
}

const estimate = (value: unknown) => Token.estimate(JSON.stringify(value))

const truncate = (value: string) =>
  value.length <= TOOL_OUTPUT_MAX_CHARS ? value : `${value.slice(0, TOOL_OUTPUT_MAX_CHARS)}\n[truncated]`

export const serializeToolContent = (content: SessionMessage.ToolStateCompleted["content"]) =>
  content
    .map((item) =>
      item.type === "text" ? item.text : `[Attached ${item.mime}${item.name === undefined ? "" : `: ${item.name}`}]`,
    )
    .join("\n")

const serialize = (message: SessionMessage.Message) => {
  if (message.type === "user") {
    const files = message.files?.map((file) => `[Attached ${file.mime}: ${file.name ?? file.uri}]`) ?? []
    return [`[User]: ${message.text}`, ...files].join("\n")
  }
  if (message.type === "assistant") {
    return message.content
      .flatMap((part) => {
        if (part.type === "text") return [`[Assistant]: ${part.text}`]
        if (part.type === "reasoning") return part.text ? [`[Assistant reasoning]: ${part.text}`] : []
        const input = typeof part.state.input === "string" ? part.state.input : JSON.stringify(part.state.input)
        if (part.state.status === "completed")
          return [
            `[Assistant tool call]: ${part.name}(${input})`,
            `[Tool result]: ${truncate(serializeToolContent(part.state.content))}`,
          ]
        if (part.state.status === "error")
          return [`[Assistant tool call]: ${part.name}(${input})`, `[Tool error]: ${part.state.error.message}`]
        return [`[Assistant tool call]: ${part.name}(${input})`]
      })
      .join("\n")
  }
  if (message.type === "system") return `[System update]: ${message.text}`
  if (message.type === "synthetic") return `[Synthetic context]: ${message.text}`
  if (message.type === "skill") return `[Skill activated: ${message.name}]\n${message.text}`
  if (message.type === "shell") return `[Shell]: ${message.command}\n${truncate(message.output)}`
  return ""
}

const settings = (documents: readonly Config.Entry[]) => {
  const configured = documents
    .filter((entry): entry is Config.Document => entry.type === "document")
    .flatMap((entry) => (entry.info.compaction ? [entry.info.compaction] : []))
  const defaults = ContextLevels.defaultLevelConfig()
  return configured.reduce<Settings>(
    (result, current) => ({
      auto: current.auto ?? result.auto,
      buffer: current.buffer ?? result.buffer,
      tokens: current.keep?.tokens ?? result.tokens,
      levels: {
        l2_trigger: current.levels?.l2_trigger ?? result.levels.l2_trigger,
        l3_trigger: current.levels?.l3_trigger ?? result.levels.l3_trigger,
        l4_trigger: current.levels?.l4_trigger ?? result.levels.l4_trigger,
        l5_trigger: current.levels?.l5_trigger ?? result.levels.l5_trigger,
        l1_max_chars: current.levels?.l1_max_chars ?? result.levels.l1_max_chars,
      },
    }),
    { auto: true, buffer: DEFAULT_BUFFER, tokens: DEFAULT_KEEP_TOKENS, levels: defaults },
  )
}

const select = (
  entries: readonly Entry[],
  tokens: number,
): { readonly head: string; readonly recent: string } | undefined => {
  const conversation = entries
    .filter((entry) => entry.message.type !== "compaction")
    .map((entry) => serialize(entry.message))
    .filter(Boolean)
  if (conversation.length === 0) return
  let total = 0
  let split = conversation.length
  let splitPrefix = ""
  let splitSuffix = ""
  for (let index = conversation.length - 1; index >= 0; index--) {
    const next = total + Token.estimate(conversation[index])
    if (next > tokens) {
      const remaining = Math.max(0, tokens - total) * 4
      if (remaining > 0) {
        splitPrefix = conversation[index].slice(0, -remaining)
        splitSuffix = conversation[index].slice(-remaining)
        split = index + 1
      }
      break
    }
    total = next
    split = index
  }
  return {
    head: [...conversation.slice(0, splitPrefix ? split - 1 : split), splitPrefix].filter(Boolean).join("\n\n"),
    recent: [splitSuffix, ...conversation.slice(split)].filter(Boolean).join("\n\n"),
  }
}

export const buildPrompt = (input: {
  readonly previousSummary?: string
  readonly context: readonly string[]
  readonly instructions?: string
}) =>
  [
    input.previousSummary
      ? `Update the anchored summary below using the conversation history above.\nPreserve still-true details, remove stale details, and merge in the new facts.\n<previous-summary>\n${input.previousSummary}\n</previous-summary>`
      : "Create a new anchored summary from the conversation history.",
    SUMMARY_TEMPLATE,
    ...input.context,
    ...(input.instructions ? [`Additional instructions from the user:\n${input.instructions}`] : []),
  ].join("\n\n")

export const make = (dependencies: Dependencies) => {
  const config = settings(dependencies.config)
  const summarize = Effect.fnUntraced(function* (input: SummarizeInput) {
    const context = input.model.route.defaults.limits?.context
    if (context === undefined || context <= 0) return false
    const selected = select(input.entries, config.tokens)
    const previousSummary = input.entries.find((entry) => entry.message.type === "compaction")?.message
    if (!selected || (selected.head.length === 0 && previousSummary?.type !== "compaction")) return false
    const summaryPrompt = buildPrompt({
      previousSummary: previousSummary?.type === "compaction" ? previousSummary.summary : undefined,
      context: [previousSummary?.type === "compaction" ? previousSummary.recent : "", selected.head].filter(Boolean),
      instructions: input.instructions,
    })
    const summaryOutput = Math.min(input.output || SUMMARY_OUTPUT_TOKENS, SUMMARY_OUTPUT_TOKENS)
    if (Token.estimate(summaryPrompt) > context - summaryOutput) return false
    const messageID = SessionMessage.ID.create()
    yield* dependencies.events.publish(SessionEvent.Compaction.Started, {
      sessionID: input.sessionID,
      messageID,
      timestamp: yield* DateTime.now,
      reason: input.reason,
    })

    const chunks: string[] = []
    let failed = false
    const summarized = yield* dependencies.llm
      .stream(
        LLM.request({
          model: input.model,
          messages: [Message.user(summaryPrompt)],
          tools: [],
          generation: { maxTokens: summaryOutput },
        }),
      )
      .pipe(
        Stream.runForEach((event) => {
          if (LLMEvent.is.providerError(event)) failed = true
          if (LLMEvent.is.textDelta(event)) chunks.push(event.text)
          return Effect.void
        }),
        Effect.as(true),
        Effect.catchTag("LLM.Error", () => Effect.succeed(false)),
      )
    const summary = chunks.join("")
    if (!summarized || failed || !summary.trim()) return false
    yield* dependencies.events.publish(SessionEvent.Compaction.Ended, {
      sessionID: input.sessionID,
      messageID,
      timestamp: yield* DateTime.now,
      reason: input.reason,
      text: summary,
      recent: selected.recent,
    })
    return true
  })
  const compactAfterOverflow = Effect.fn("SessionCompaction.compactAfterOverflow")(function* (input: Input) {
    return yield* summarize({
      sessionID: input.sessionID,
      entries: input.entries,
      model: input.model,
      output: input.request.generation?.maxTokens ?? input.model.route.defaults.limits?.output ?? 0,
      reason: "auto",
    })
  })
  const compactManually = Effect.fn("SessionCompaction.compactManually")(function* (input: ManualInput) {
    return yield* summarize({
      sessionID: input.sessionID,
      entries: input.entries,
      model: input.model,
      output: input.model.route.defaults.limits?.output ?? 0,
      reason: "manual",
      instructions: input.instructions,
    })
  })
  const degrade = Effect.fn("SessionCompaction.degrade")(function* (input: Input) {
    if (!config.auto) return { compacted: false, request: input.request }
    const context = input.model.route.defaults.limits?.context
    if (context === undefined || context <= 0) return { compacted: false, request: input.request }
    const output = input.request.generation?.maxTokens ?? input.model.route.defaults.limits?.output ?? 0
    const usedTokens = estimate({ system: input.request.system, messages: input.request.messages, tools: input.request.tools })
    const usageRatio = usedTokens / context
    const level = ContextLevels.computeLevel(usageRatio, config.levels)
    const alreadyCompacted = input.entries.some((entry) => entry.message.type === "compaction")

    if (level <= 1) return { compacted: false, request: input.request }
    // L2 — Snip Compact: drop oldest messages (in-memory only, no durable event).
    // Once a compaction checkpoint anchors the history, in-memory snips would
    // drop the summary itself; only summary-based degradation may follow.
    if (level === 2) {
      if (alreadyCompacted) return { compacted: false, request: input.request }
      const trimmed = ContextLevels.snipCompact(input.request.messages, config.tokens)
      if (trimmed.length >= input.request.messages.length) return { compacted: false, request: input.request }
      return { compacted: false, request: LLMRequest.update(input.request, { messages: trimmed }) }
    }
    // L3 — Microcompact: deduplicate repeated file edits, then snip if still over (in-memory only, no durable event)
    if (level === 3) {
      if (alreadyCompacted) return { compacted: false, request: input.request }
      const deduped = ContextLevels.microcompact(input.request.messages)
      const dedupedTokens = estimate({ system: input.request.system, messages: deduped, tools: input.request.tools })
      if (dedupedTokens < context - Math.max(output, config.buffer)) {
        return { compacted: false, request: LLMRequest.update(input.request, { messages: deduped }) }
      }
      const trimmed = ContextLevels.snipCompact(deduped, config.tokens)
      if (trimmed.length >= deduped.length) {
        return { compacted: false, request: LLMRequest.update(input.request, { messages: deduped }) }
      }
      return { compacted: false, request: LLMRequest.update(input.request, { messages: trimmed }) }
    }
    // L4 / L5 — Summary-based compaction (existing flow)
    const summarized = yield* summarize({
      sessionID: input.sessionID,
      entries: input.entries,
      model: input.model,
      output: input.request.generation?.maxTokens ?? input.model.route.defaults.limits?.output ?? 0,
      reason: "auto",
    })
    return { compacted: summarized, request: input.request }
  })
  return {
    compactAfterOverflow,
    compactManually,
    degrade,
    settings: config,
  }
}
