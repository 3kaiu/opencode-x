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
  const existingText = existing.length === 0
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

export const consolidate = async (sessionSummaries: ReadonlyArray<string>): Promise<void> => {
  if (sessionSummaries.length === 0) return

  const existing = await loadMemories()
  const _prompt = buildPrompt(existing, sessionSummaries)

  try {
    const response = await Bun.stdin.text() // placeholder - in real usage, call LLM
    const parsed = JSON.parse(response) as ReadonlyArray<{
      category: Memory["category"]
      title: string
      content: string
      keywords: ReadonlyArray<string>
    }>

    const now = new Date().toISOString()
    const newMemories: ReadonlyArray<Memory> = parsed.map((item) => ({
      id: crypto.randomUUID(),
      category: item.category,
      title: item.title,
      content: item.content,
      keywords: item.keywords,
      created_at: now,
      updated_at: now,
    }))

    const merged = [...existing, ...newMemories].slice(-200)
    await saveMemories(merged)
    await writeLastDream(Date.now())
  } catch {
    // Silently fail - don't crash on consolidation errors
  }
}

export const Dream = {
  shouldConsolidate,
  consolidate,
}
