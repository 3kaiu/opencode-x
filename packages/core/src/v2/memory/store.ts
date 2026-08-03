// V2 memory — wire event-sourced storage (M5 §5.6).
// Append-only wire log + self-describing state + tombstone index.
// Design source: kimi-code wire.jsonl / session_index.jsonl (append-only,
// crash-tolerant, O_APPEND semantics).
export * as Memory from "./store"

import { promises as fs } from "node:fs"
import path from "node:path"

export type MemoryCategory = "user" | "feedback" | "project" | "reference" | "lesson"

export interface MemoryEntry {
  readonly id: string
  readonly category: MemoryCategory
  readonly title: string
  readonly content: string
  readonly keywords: ReadonlyArray<string>
  readonly created_at: number
  readonly updated_at: number
  readonly sourceRef?: string
  readonly status: "confirmed" | "pending"
  readonly supersedes?: ReadonlyArray<string>
}

export type WireEvent =
  | { readonly type: "memory.upsert"; readonly entry: MemoryEntry }
  | { readonly type: "memory.delete"; readonly id: string }

export interface MemoryStore {
  readonly dir: string
  readonly wirePath: string
  readonly indexPath: string
}

export async function openMemory(dir: string): Promise<MemoryStore> {
  await fs.mkdir(dir, { recursive: true })
  return { dir, wirePath: path.join(dir, "memories.wire.jsonl"), indexPath: path.join(dir, "session_index.jsonl") }
}

/** Append-only write: O(1) amortized, crash-tolerant (tolerates trailing half-line). */
export async function appendWire(store: MemoryStore, event: WireEvent): Promise<void> {
  const line = `${JSON.stringify(event)}\n`
  await fs.appendFile(store.wirePath, line, { flag: "a" })
}

/** Rebuild the in-memory map from the wire log, tolerating a trailing partial line. */
export async function replayWire(store: MemoryStore): Promise<Map<string, MemoryEntry>> {
  let text: string
  try {
    text = await fs.readFile(store.wirePath, "utf8")
  } catch {
    return new Map()
  }
  if (text.endsWith("\n")) text = text.slice(0, -1)
  const entries = new Map<string, MemoryEntry>()
  for (const line of text.split("\n")) {
    if (!line.trim()) continue
    try {
      const event = JSON.parse(line) as WireEvent
      if (event.type === "memory.upsert") entries.set(event.entry.id, event.entry)
      else if (event.type === "memory.delete") entries.delete(event.id)
    } catch {
      // trailing partial line — ignore (crash tolerance)
    }
  }
  return entries
}

/** Self-describing state snapshot (mirrors kimi state.json; sorted by updated_at). */
export async function writeState(store: MemoryStore, entries: ReadonlyArray<MemoryEntry>): Promise<void> {
  const sorted = [...entries].sort((a, b) => b.updated_at - a.updated_at)
  await fs.writeFile(path.join(store.dir, "state.json"), JSON.stringify(sorted, null, 2))
}

export async function readState(store: MemoryStore): Promise<ReadonlyArray<MemoryEntry>> {
  try {
    const raw = await fs.readFile(path.join(store.dir, "state.json"), "utf8")
    return JSON.parse(raw) as ReadonlyArray<MemoryEntry>
  } catch {
    return []
  }
}

export function nextID(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

/** Confirm a pending entry (user or repeated-use promotion). */
export async function confirmEntry(store: MemoryStore, id: string): Promise<void> {
  const entries = await replayWire(store)
  const entry = entries.get(id)
  if (!entry || entry.status === "confirmed") return
  await appendWire(store, {
    type: "memory.upsert",
    entry: { ...entry, status: "confirmed", updated_at: Date.now() },
  })
}
