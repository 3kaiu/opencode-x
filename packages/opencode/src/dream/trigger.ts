export * as DreamTrigger from "./trigger"

import { loadMemories, saveMemories, type Memory } from "@opencode-ai/core/memory/store"
import { Database } from "@opencode-ai/core/database/database"
import { SessionMessageTable } from "@opencode-ai/core/session/sql"
import { eq, desc } from "drizzle-orm"
import { Effect, Layer } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { LLMClient } from "@opencode-ai/llm/route"
import { LLM, SystemPart, Message } from "@opencode-ai/llm"
import { llmClient } from "@opencode-ai/core/effect/app-node-platform"
import { Catalog } from "@opencode-ai/core/catalog"
import { SessionRunnerModel } from "@opencode-ai/core/session/runner/model"

const DREAM_DIR = `${process.env.HOME}/.config/opencode/memory`
const DREAM_FILE = `${DREAM_DIR}/last-dream.json`
const CONSOLIDATION_INTERVAL_MS = 24 * 60 * 60 * 1000

const shouldConsolidate = Effect.promise(async () => {
  const file = Bun.file(DREAM_FILE)
  if (!(await file.exists())) return true
  const data = await file.json()
  return Date.now() - (data.timestamp ?? 0) >= CONSOLIDATION_INTERVAL_MS
})

const writeLastDream = Effect.promise(async () => {
  await Bun.write(DREAM_FILE, JSON.stringify({ timestamp: Date.now() }, null, 2))
})

const buildPrompt = (existing: ReadonlyArray<Memory>, summaries: ReadonlyArray<string>): string => {
  const existingText =
    existing.length === 0
      ? "(no existing memories)"
      : existing.map((m) => `- [${m.category}] ${m.title}: ${m.content}`).join("\n")
  return `You are a memory consolidation assistant. Extract and maintain important facts from session summaries.

EXISTING MEMORIES:
${existingText}

NEW SESSION SUMMARIES:
${summaries.join("\n---\n")}

INSTRUCTIONS:
1. Extract new facts, preferences, or project details from the summaries
2. Merge duplicates - if a fact already exists, update it rather than creating a new one
3. Remove outdated information that conflicts with newer data
4. Categorize each memory: user (preferences/habits), feedback (corrections), project (tech details), reference (facts to remember)

Respond with a JSON array of memory objects:
[{"category": "user|feedback|project|reference", "title": "short title", "content": "detailed content", "keywords": ["key1", "key2"]}]

If no new memories should be extracted, respond with: []`
}

const extractJson = (text: string): string => {
  const fenced = text.match(/```(?:json)?\s*\n?([\s\S]*?)```/)
  if (fenced) return fenced[1].trim()
  const bracket = text.indexOf("[")
  const lastBracket = text.lastIndexOf("]")
  if (bracket >= 0 && lastBracket > bracket) return text.slice(bracket, lastBracket + 1)
  return text.trim()
}

/**
 * Background Dream consolidation trigger.
 *
 * Runs once at Location boot: if 24h have passed since the last consolidation,
 * reads recent compaction summaries from the database and calls the LLM to
 * merge them into long-term memories.
 *
 * Best-effort: all failures are logged and swallowed.
 */
const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const shouldRun = yield* shouldConsolidate
    if (!shouldRun) return

    const { db } = yield* Database.Service

    // Read recent compaction summaries (last 10)
    const rows = yield* db
      .select({ data: SessionMessageTable.data })
      .from(SessionMessageTable)
      .where(eq(SessionMessageTable.type, "compaction"))
      .orderBy(desc(SessionMessageTable.time_created))
      .limit(10)
      .all()
      .pipe(Effect.orDie)

    const summaries = rows
      .map((row) => {
        const data = row.data as Record<string, unknown>
        return typeof data.summary === "string" ? data.summary : undefined
      })
      .filter((s): s is string => s !== undefined && s.length > 0)

    if (summaries.length === 0) return

    // Resolve the default model for the consolidation call
    const catalog = yield* Catalog.Service
    const defaultModel = yield* catalog.model.default().pipe(Effect.catch(() => Effect.succeed(undefined)))
    if (!defaultModel || !SessionRunnerModel.supported(defaultModel)) return

    const models = yield* SessionRunnerModel.Service
    const llm = yield* LLMClient.Service

    const existing = yield* Effect.promise(() => loadMemories())
    const prompt = buildPrompt(existing, summaries)

    // One-shot LLM call for consolidation
    const model = yield* SessionRunnerModel.fromCatalogModel(defaultModel).pipe(
      Effect.catch(() => Effect.succeed(undefined)),
    )
    if (!model) return

    const response = yield* llm.generate(
      LLM.request({
        model,
        system: [SystemPart.make("You are a memory consolidation assistant. Respond only with valid JSON.")],
        messages: [Message.user(prompt)],
        generation: { maxTokens: 4096 },
      }),
    )

    const text = response.text

    // Parse and merge memories
    const parsed = JSON.parse(extractJson(text)) as ReadonlyArray<{
      category: Memory["category"]
      title: string
      content: string
      keywords: ReadonlyArray<string>
    }>

    if (!Array.isArray(parsed) || parsed.length === 0) {
      yield* writeLastDream
      return
    }

    const now = new Date().toISOString()
    const newMemories = parsed
      .filter(
        (item): item is { category: Memory["category"]; title: string; content: string; keywords: string[] } =>
          typeof item.title === "string" &&
          typeof item.content === "string" &&
          ["user", "feedback", "project", "reference"].includes(item.category),
      )
      .map((item) => ({
        id: crypto.randomUUID(),
        category: item.category,
        title: item.title,
        content: item.content,
        keywords: Array.isArray(item.keywords) ? item.keywords : [],
        created_at: now,
        updated_at: now,
      }))

    const byTitle = new Map(existing.map((m) => [m.title.toLowerCase(), m]))
    const merged = [...existing]
    for (const mem of newMemories) {
      const match = byTitle.get(mem.title.toLowerCase())
      if (match) {
        const index = merged.indexOf(match)
        if (index >= 0) merged[index] = { ...mem, id: match.id, created_at: match.created_at }
      } else {
        merged.push(mem)
      }
    }

    yield* Effect.promise(() => saveMemories(merged.slice(-200)))
    yield* writeLastDream
    yield* Effect.logInfo("Dream consolidation complete", { memories: newMemories.length })
  }).pipe(
    Effect.tapError((error) =>
      Effect.logWarning("Dream consolidation failed", {
        error: error instanceof Error ? error.message : String(error),
      }),
    ),
    Effect.ignore,
  ),
)

export const node = LayerNode.make({
  name: "dream-trigger",
  layer,
  deps: [Database.node, Catalog.node, SessionRunnerModel.node, llmClient],
})
