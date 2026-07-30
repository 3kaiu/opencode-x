export interface Memory {
  readonly id: string
  readonly category: "user" | "feedback" | "project" | "reference"
  readonly title: string
  readonly content: string
  readonly keywords: ReadonlyArray<string>
  readonly created_at: string
  readonly updated_at: string
}

const MEMORY_DIR = `${process.env.HOME}/.config/opencode/memory`
const MEMORY_FILE = `${MEMORY_DIR}/memories.json`
const MAX_MEMORIES = 200

const ensureDir = async () => {
  await Bun.write(`${MEMORY_DIR}/.gitkeep`, "")
}

export const loadMemories = async (): Promise<ReadonlyArray<Memory>> => {
  const file = Bun.file(MEMORY_FILE)
  if (!(await file.exists())) return []
  const data = await file.json()
  return data as ReadonlyArray<Memory>
}

export const saveMemories = async (memories: ReadonlyArray<Memory>): Promise<void> => {
  await ensureDir()
  await Bun.write(MEMORY_FILE, JSON.stringify(memories, null, 2))
}

export const addMemory = async (
  category: Memory["category"],
  title: string,
  content: string,
  keywords: ReadonlyArray<string>,
): Promise<Memory> => {
  const memories = await loadMemories()
  const now = new Date().toISOString()
  const memory: Memory = {
    id: crypto.randomUUID(),
    category,
    title,
    content,
    keywords,
    created_at: now,
    updated_at: now,
  }
  const updated = [...memories, memory].slice(-MAX_MEMORIES)
  await saveMemories(updated)
  return memory
}

export const updateMemory = async (id: string, updates: Partial<Omit<Memory, "id" | "created_at">>): Promise<void> => {
  const memories = await loadMemories()
  const updated = memories.map((m) => {
    if (m.id !== id) return m
    return { ...m, ...updates, updated_at: new Date().toISOString() }
  })
  await saveMemories(updated)
}

export const deleteMemory = async (id: string): Promise<void> => {
  const memories = await loadMemories()
  await saveMemories(memories.filter((m) => m.id !== id))
}

export const getIndex = async (): Promise<ReadonlyArray<Pick<Memory, "id" | "category" | "title" | "keywords">>> => {
  const memories = await loadMemories()
  return memories.map((m) => ({
    id: m.id,
    category: m.category,
    title: m.title,
    keywords: m.keywords,
  }))
}
