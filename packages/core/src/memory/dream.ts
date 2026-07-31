import { loadMemories, saveMemories, type Memory } from "./store"

const DREAM_DIR = `${process.env.HOME}/.config/opencode/memory`
const DREAM_FILE = `${DREAM_DIR}/last-dream.json`
const CONSOLIDATION_INTERVAL_MS = 24 * 60 * 60 * 1000

const readLastDream = async (): Promise<number> => {
  const file = Bun.file(DREAM_FILE)
  if (!(await file.exists())) return 0
  const data = await file.json()
  return data.timestamp ?? 0
}

const writeLastDream = async (timestamp: number): Promise<void> => {
  await Bun.write(DREAM_FILE, JSON.stringify({ timestamp }, null, 2))
}

export const shouldConsolidate = async (): Promise<boolean> => {
  const last = await readLastDream()
  return Date.now() - last >= CONSOLIDATION_INTERVAL_MS
}

const buildPrompt = (existing: ReadonlyArray<Memory>, summaries: ReadonlyArray<string>): string => {
  const existingText =
    existing.length === 0
      ? "(no existing memories)"
      : existing.map((m) => `- [${m.category}] ${m.title}: ${m.content}`).join("\n")

  const summariesText = summaries.join("\n---\n")

  return `You are a memory consolidation assistant. Extract and maintain important facts from session summaries.

EXISTING MEMORIES:
${existingText}

NEW SESSION SUMMARIES:
${summariesText}

INSTRUCTIONS:
1. Extract new facts, preferences, or project details from the summaries
2. Merge duplicates - if a fact already exists, update it rather than creating a new one
3. Remove outdated information that conflicts with newer data
4. Categorize each memory: user (preferences/habits), feedback (corrections), project (tech details), reference (facts to remember)

Respond with a JSON array of memory objects:
[{"category": "user|feedback|project|reference", "title": "short title", "content": "detailed content", "keywords": ["key1", "key2"]}]

If no new memories should be extracted, respond with: []`
}

/** Extract JSON array from LLM response that may contain markdown fences. */
const extractJson = (text: string): string => {
  const fenced = text.match(/```(?:json)?\s*\n?([\s\S]*?)```/)
  if (fenced) return fenced[1].trim()
  const bracket = text.indexOf("[")
  const lastBracket = text.lastIndexOf("]")
  if (bracket >= 0 && lastBracket > bracket) return text.slice(bracket, lastBracket + 1)
  return text.trim()
}

/**
 * Consolidate session summaries into long-term memories.
 * @param sessionSummaries - Compaction summaries from recent sessions.
 * @param generate - LLM text generation function injected by the caller.
 *   Receives the consolidation prompt, returns the raw LLM response text.
 */
export const consolidate = async (
  sessionSummaries: ReadonlyArray<string>,
  generate: (prompt: string) => Promise<string>,
): Promise<void> => {
  if (sessionSummaries.length === 0) return

  const existing = await loadMemories()
  const prompt = buildPrompt(existing, sessionSummaries)

  try {
    const response = await generate(prompt)
    const parsed = JSON.parse(extractJson(response)) as ReadonlyArray<{
      category: Memory["category"]
      title: string
      content: string
      keywords: ReadonlyArray<string>
    }>

    if (!Array.isArray(parsed) || parsed.length === 0) {
      await writeLastDream(Date.now())
      return
    }

    const now = new Date().toISOString()
    const newMemories: ReadonlyArray<Memory> = parsed
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

    // Merge: update existing memories by title match, append new ones
    const byTitle = new Map(existing.map((m) => [m.title.toLowerCase(), m]))
    const merged = [...existing]
    for (const mem of newMemories) {
      const existingMatch = byTitle.get(mem.title.toLowerCase())
      if (existingMatch) {
        const index = merged.indexOf(existingMatch)
        if (index >= 0) merged[index] = { ...mem, id: existingMatch.id, created_at: existingMatch.created_at }
      } else {
        merged.push(mem)
      }
    }

    await saveMemories(merged.slice(-200))
    await writeLastDream(Date.now())
  } catch {
    // Silently fail — consolidation is best-effort background work
  }
}

export const Dream = {
  shouldConsolidate,
  consolidate,
}
