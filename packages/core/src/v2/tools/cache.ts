// V2 tool system — result cache (M3 §3.6 rule 7).
// Read-only, hashable tools (grep/glob/read metadata) cache by
// (tool, argsHash, involved-file-mtimes). Any write to an involved file
// invalidates the entry. Cache is an LRU with a size cap.
export * as ToolCache from "./cache"

import { createHash } from "node:crypto"

export interface CacheKey {
  readonly tool: string
  readonly argsHash: string
  readonly mtimes: ReadonlyArray<{ readonly path: string; readonly mtimeMs: number }>
}

export interface ToolCacheState {
  readonly entries: ReadonlyMap<string, { readonly value: unknown; readonly mtimeMs: number; readonly lastAccess: number }>
  readonly cap: number
}

export function createCache(cap = 512): ToolCacheState {
  return { entries: new Map(), cap }
}

export function hashArgs(args: unknown): string {
  return createHash("sha1").update(JSON.stringify(args ?? {})).digest("hex").slice(0, 16)
}

function keyFor(key: CacheKey): string {
  const mtimes = key.mtimes.map((m) => `${m.path}:${m.mtimeMs}`).sort().join("|")
  return `${key.tool}:${key.argsHash}:${mtimes}`
}

export function lookup(state: ToolCacheState, key: CacheKey): unknown | undefined {
  const k = keyFor(key)
  const entry = state.entries.get(k)
  if (!entry) return undefined
  // stale if any involved file changed since the entry was written
  for (const m of key.mtimes) {
    if (m.mtimeMs > entry.mtimeMs) return undefined
  }
  // touch LRU
  const next = new Map(state.entries)
  next.delete(k)
  next.set(k, { ...entry, lastAccess: Date.now() })
  return entry.value
}

export function store(state: ToolCacheState, key: CacheKey, value: unknown): ToolCacheState {
  const k = keyFor(key)
  const next = new Map(state.entries)
  next.set(k, { value, mtimeMs: Date.now(), lastAccess: Date.now() })
  // LRU eviction: drop least recently used until under cap
  while (next.size > state.cap) {
    let oldest: { readonly key: string; readonly access: number } | null = null
    for (const [ek, entry] of next) {
      if (oldest === null || entry.lastAccess < oldest.access) oldest = { key: ek, access: entry.lastAccess }
    }
    if (oldest) next.delete(oldest.key)
  }
  return { ...state, entries: next }
}

/** Any write to an involved path invalidates matching entries. */
export function invalidatePaths(state: ToolCacheState, paths: ReadonlyArray<string>): ToolCacheState {
  const next = new Map(state.entries)
  for (const key of [...next.keys()]) {
    // key format: tool:argsHash:path1:mtime1|path2:mtime2
    const pathPart = key.split(":").slice(2).join(":")
    if (paths.some((p) => pathPart.includes(p))) next.delete(key)
  }
  return { ...state, entries: next }
}

/** Reads cache with an automatic store-when-miss wrapper. */
export function cached<A>(
  state: ToolCacheState,
  key: CacheKey,
  compute: () => A,
): { readonly state: ToolCacheState; readonly value: A; readonly hit: boolean } {
  const hit = lookup(state, key)
  if (hit !== undefined) return { state, value: hit as A, hit: true }
  const value = compute()
  return { state: store(state, key, value), value, hit: false }
}
