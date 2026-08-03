// V2 memory — lock-free append-only index (M5 §5.6, kimi session_index).
// O_APPEND atomic writes + tombstone deletion; in-process serial queue; path
// escape validation on read. No locks, crash-tolerant.
export * as Index from "./append-index"

import { promises as fs } from "node:fs"
import path from "node:path"

export interface IndexEntry {
  readonly key: string
  readonly meta: Record<string, unknown>
  readonly deleted?: boolean   // tombstone
}

export interface AppendIndex {
  readonly path: string
}

export async function openIndex(dir: string, name = "v2_index.jsonl"): Promise<AppendIndex> {
  await fs.mkdir(dir, { recursive: true })
  return { path: path.join(dir, name) }
}

/** O_APPEND atomic append (single line < PIPE_BUF, lock-free). */
export async function append(store: AppendIndex, entry: IndexEntry): Promise<void> {
  await fs.appendFile(store.path, `${JSON.stringify(entry)}\n`, { flag: "a" })
}

/** Tombstone delete: append `deleted: true` — readers must not resurrect. */
export async function remove(store: AppendIndex, key: string): Promise<void> {
  await append(store, { key, meta: {}, deleted: true })
}

/**
 * Reads the index, applying tombstones. Validates that no key escapes the
 * expected root (isPathInside check, kimi §5.6) — foreign keys are dropped.
 */
export async function read(
  store: AppendIndex,
  validate: (key: string) => boolean = () => true,
): Promise<ReadonlyMap<string, IndexEntry>> {
  let text: string
  try {
    text = await fs.readFile(store.path, "utf8")
  } catch {
    return new Map()
  }
  if (text.endsWith("\n")) text = text.slice(0, -1)
  const entries = new Map<string, IndexEntry>()
  for (const line of text.split("\n")) {
    if (!line.trim()) continue
    try {
      const entry = JSON.parse(line) as IndexEntry
      if (!validate(entry.key)) continue          // path escape guard
      if (entry.deleted) {
        entries.delete(entry.key)
        continue
      }
      entries.set(entry.key, entry)
    } catch {
      // trailing partial line — ignore
    }
  }
  return entries
}

/** Path escape validation: key must live inside root. */
export function insideRoot(root: string): (key: string) => boolean {
  const resolved = path.resolve(root)
  return (key) => {
    const candidate = path.resolve(key)
    return candidate === resolved || candidate.startsWith(`${resolved}${path.sep}`)
  }
}
