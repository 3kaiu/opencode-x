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

export const loadMemories = async (): Promise<ReadonlyArray<Memory>> => {
  const file = Bun.file(MEMORY_FILE)
  if (!(await file.exists())) return []
  const data = await file.json()
  return data as ReadonlyArray<Memory>
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
