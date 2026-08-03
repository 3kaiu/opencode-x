// V2 world perception — file index (M2 §2.6).
// Incrementally maintained directory index: entries keyed by path with mtime,
// a generation counter, and debounced batch events. Write tools bump the index
// before returning (event said changed → index reflects it).
export * as FileIndex from "./file-index"

import { promises as fs } from "node:fs"
import path from "node:path"

export interface FileEntry {
  readonly path: string
  readonly size: number
  readonly mtimeMs: number
  readonly isDir: boolean
}

export interface FileIndexState {
  readonly root: string
  readonly entries: ReadonlyMap<string, FileEntry>
  readonly generation: number
  readonly ignore: ReadonlyArray<string>   // path prefixes to skip (gitignore-ish, minimal)
}

export async function scanDir(root: string, ignore: ReadonlyArray<string> = []): Promise<FileIndexState> {
  const entries = new Map<string, FileEntry>()
  const stack: string[] = [root]
  const ignored = ignore.map((p) => path.resolve(root, p))
  const isIgnored = (p: string) => ignored.some((ig) => p === ig || p.startsWith(`${ig}${path.sep}`))
  while (stack.length > 0) {
    const dir = stack.pop()!
    let items: Array<{ readonly name: string; readonly isDirectory: () => boolean; readonly isFile: () => boolean }>
    try {
      items = (await fs.readdir(dir, { withFileTypes: true })) as unknown as Array<{
        readonly name: string
        readonly isDirectory: () => boolean
        readonly isFile: () => boolean
      }>
    } catch {
      continue
    }
    for (const item of items) {
      const full = path.join(dir, item.name)
      if (isIgnored(full)) continue
      if (item.isDirectory()) {
        if (item.name === "node_modules" || item.name === ".git") continue
        stack.push(full)
        entries.set(full, { path: full, size: 0, mtimeMs: 0, isDir: true })
      } else if (item.isFile()) {
        try {
          const stat = await fs.stat(full)
          entries.set(full, { path: full, size: stat.size, mtimeMs: stat.mtimeMs, isDir: false })
        } catch {
          // raced deletion — skip
        }
      }
    }
  }
  return { root, entries, generation: 1, ignore }
}

/** Applies a change event set; bumps generation. Returns updated state. */
export function applyChanges(
  state: FileIndexState,
  changes: ReadonlyArray<{ readonly type: "add" | "remove" | "modify"; readonly path: string }>,
): FileIndexState {
  const entries = new Map(state.entries)
  for (const change of changes) {
    if (change.type === "remove") {
      // remove entry and any descendants
      for (const key of [...entries.keys()]) {
        if (key === change.path || key.startsWith(`${change.path}${path.sep}`)) entries.delete(key)
      }
    } else {
      entries.set(change.path, {
        path: change.path,
        size: 0,
        mtimeMs: Date.now(),
        isDir: false,
      })
    }
  }
  return { ...state, entries, generation: state.generation + 1 }
}

export function lookup(state: FileIndexState, p: string): FileEntry | undefined {
  return state.entries.get(p)
}

export function entriesUnder(state: FileIndexState, dir: string): ReadonlyArray<FileEntry> {
  const prefix = `${dir}${path.sep}`
  return [...state.entries.values()].filter((e) => e.path.startsWith(prefix))
}

/** Path containment helper shared with the scheduler conflict rules. */
export function pathInside(child: string, parent: string): boolean {
  return child === parent || child.startsWith(parent.endsWith("/") ? parent : `${parent}/`)
}
