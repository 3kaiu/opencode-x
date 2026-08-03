// V2 memory — lock-is-election full-text index (M5 §5.6, kimi searchService).
// The process that wins the write lock becomes the indexer; others read a
// shared view. The index is a pure derived cache — on crash it rebuilds from
// the wire log, never losing data. Fingerprint check avoids reload when
// nothing changed; incremental catch-up replays only the new byte range.
export * as SearchIndex from "./search-index"

import { promises as fs } from "node:fs"
import path from "node:path"
import { tokenize } from "./search"

export interface SearchIndexState {
  readonly wirePath: string
  readonly indexDir: string
  readonly postingsPath: string
  readonly fingerprintPath: string
}

export interface Postings {
  readonly df: ReadonlyMap<string, number>                    // term → doc count
  readonly postings: ReadonlyMap<string, ReadonlyMap<string, number>>  // term → docID → tf
  readonly docLengths: ReadonlyMap<string, number>            // docID → token count
  readonly docFingerprints: ReadonlyMap<string, string>       // docID → content hash
  readonly totalDocs: number
  readonly builtAt: number
}

export async function openSearchIndex(dir: string, wirePath: string): Promise<SearchIndexState> {
  await fs.mkdir(dir, { recursive: true })
  return {
    wirePath,
    indexDir: dir,
    postingsPath: path.join(dir, "postings.json"),
    fingerprintPath: path.join(dir, "index.fingerprint"),
  }
}

/** Reads the wire log byte length (cheap fingerprint of change). */
export async function wireFingerprint(state: SearchIndexState): Promise<{ readonly length: number; readonly mtime: number }> {
  try {
    const stat = await fs.stat(state.wirePath)
    return { length: stat.size, mtime: stat.mtimeMs }
  } catch {
    return { length: 0, mtime: 0 }
  }
}

/** Detects whether the on-disk index matches the current wire log. */
export async function isFresh(state: SearchIndexState): Promise<boolean> {
  const current = await wireFingerprint(state)
  let stored: { length: number; mtime: number } | null = null
  try {
    stored = JSON.parse(await fs.readFile(state.fingerprintPath, "utf8"))
  } catch {
    return false
  }
  return stored !== null && stored.length === current.length && stored.mtime === current.mtime
}

async function writeFingerprint(state: SearchIndexState): Promise<void> {
  const current = await wireFingerprint(state)
  await fs.writeFile(state.fingerprintPath, JSON.stringify(current))
}

export async function loadPostings(state: SearchIndexState): Promise<Postings | null> {
  try {
    const raw = await fs.readFile(state.postingsPath, "utf8")
    const parsed = JSON.parse(raw) as {
      df: Record<string, number>
      postings: Record<string, Record<string, number>>
      docLengths: Record<string, number>
      docFingerprints: Record<string, string>
      totalDocs: number
      builtAt: number
    }
    return {
      df: new Map(Object.entries(parsed.df)),
      postings: new Map(Object.entries(parsed.postings).map(([k, v]) => [k, new Map(Object.entries(v))])),
      docLengths: new Map(Object.entries(parsed.docLengths)),
      docFingerprints: new Map(Object.entries(parsed.docFingerprints)),
      totalDocs: parsed.totalDocs,
      builtAt: parsed.builtAt,
    }
  } catch {
    return null
  }
}

export interface IndexableDoc {
  readonly id: string
  readonly text: string
}

function hashDoc(text: string): string {
  let h = 0
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) | 0
  return (h >>> 0).toString(16)
}

/**
 * Builds postings from docs. Pure derived cache: caller persists it; a crash
 * just means rebuilding on the next open (kimi: "rebuild from Store, never
 * loses data").
 */
export function buildPostings(docs: ReadonlyArray<IndexableDoc>): Postings {
  const df = new Map<string, number>()
  const postings = new Map<string, Map<string, number>>()
  const docLengths = new Map<string, number>()
  const docFingerprints = new Map<string, string>()
  for (const doc of docs) {
    const tokens = tokenize(doc.text)
    docLengths.set(doc.id, tokens.length)
    docFingerprints.set(doc.id, hashDoc(doc.text))
    const tf = new Map<string, number>()
    for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1)
    for (const [term, count] of tf) {
      if (!postings.has(term)) postings.set(term, new Map())
      postings.get(term)!.set(doc.id, count)
      df.set(term, (df.get(term) ?? 0) + 1)
    }
  }
  return {
    df,
    postings,
    docLengths,
    docFingerprints,
    totalDocs: docs.length,
    builtAt: Date.now(),
  }
}

/** Incremental catch-up: re-indexes only docs whose hash changed (kimi byte-range anchor). */
export function incrementalIndex(previous: Postings, docs: ReadonlyArray<IndexableDoc>): Postings {
  const changed = docs.filter((d) => previous.docFingerprints.get(d.id) !== hashDoc(d.text))
  if (changed.length === 0) return previous
  // Simplest correct approach at this scale: rebuild. Incremental postings
  // mutation is a future optimization; the design anchor (hash compare) is in
  // place so rebuilds only happen on actual change.
  return buildPostings(docs)
}

/** Persists postings + fingerprint. Caller holds the write lock (elected). */
export async function persistIndex(state: SearchIndexState, postings: Postings): Promise<void> {
  await fs.writeFile(
    state.postingsPath,
    JSON.stringify({
      df: Object.fromEntries(postings.df),
      postings: Object.fromEntries([...postings.postings].map(([k, v]) => [k, Object.fromEntries(v)])),
      docLengths: Object.fromEntries(postings.docLengths),
      docFingerprints: Object.fromEntries(postings.docFingerprints),
      totalDocs: postings.totalDocs,
      builtAt: postings.builtAt,
    }),
  )
  await writeFingerprint(state)
}

/** Lock is election: returns true when this process wins the index write lock. */
export async function tryAcquireIndexLock(indexDir: string, staleMs = 60_000): Promise<boolean> {
  const lockPath = path.join(indexDir, "index.lock")
  try {
    const handle = await fs.open(lockPath, "wx")
    await handle.writeFile(JSON.stringify({ pid: process.pid, at: Date.now() }))
    await handle.close()
    return true
  } catch (e) {
    const err = e as { code?: string }
    if (err.code !== "EEXIST") return false
    // stale lock check: if the lock is old, steal it
    try {
      const stat = await fs.stat(lockPath)
      if (Date.now() - stat.mtimeMs > staleMs) {
        await fs.rm(lockPath, { force: true })
        return tryAcquireIndexLock(indexDir, staleMs)
      }
    } catch {
      // raced removal
    }
    return false
  }
}

export async function releaseIndexLock(indexDir: string): Promise<void> {
  await fs.rm(path.join(indexDir, "index.lock"), { force: true })
}

/** TF-IDF search over postings. */
export function searchPostings(
  postings: Postings,
  query: string,
  topK = 10,
): ReadonlyArray<{ readonly id: string; readonly score: number }> {
  const qTokens = tokenize(query)
  if (qTokens.length === 0 || postings.totalDocs === 0) return []
  const N = postings.totalDocs
  const scores = new Map<string, number>()
  for (const term of qTokens) {
    const docs = postings.postings.get(term)
    if (!docs) continue
    const idf = Math.log((N + 1) / ((postings.df.get(term) ?? 0) + 1)) + 1
    for (const [docID, tf] of docs) {
      const len = postings.docLengths.get(docID) ?? 1
      scores.set(docID, (scores.get(docID) ?? 0) + (tf / len) * idf)
    }
  }
  return [...scores.entries()]
    .map(([id, score]) => ({ id, score }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
}
