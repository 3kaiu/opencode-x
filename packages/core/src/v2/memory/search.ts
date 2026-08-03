// V2 memory — full-text retrieval (M5 §5.6).
// Zero-dependency tokenizer: latin words + CJK bigrams. TF-IDF scoring over
// the in-memory entry index. Postings stay in memory at this scale (memory
// entries are small); the design allows spilling to disk for large corpora.
export * as MemorySearch from "./search"

import type { MemoryEntry } from "./store"

/** Tokenizes: latin word chunks + CJK single/bigram (zero-dependency, kimi design). */
export function tokenize(text: string): ReadonlyArray<string> {
  const tokens: string[] = []
  const cjk = text.match(/[\u4e00-\u9fff]+/g) ?? []
  for (const seg of cjk) {
    if (seg.length === 1) {
      tokens.push(seg)
    } else {
      for (let i = 0; i < seg.length - 1; i++) tokens.push(seg.slice(i, i + 2))
      tokens.push(seg.slice(-1))
    }
  }
  const latin = text.replace(/[\u4e00-\u9fff]+/g, " ").match(/[a-zA-Z0-9_-]+/g) ?? []
  for (const w of latin) tokens.push(w.toLowerCase())
  return tokens
}

export interface ScoredEntry {
  readonly entry: MemoryEntry
  readonly score: number
}

/** TF-IDF over the entry set. query tokens → per-doc TF × log(N/df) IDF. */
export function search(
  entries: ReadonlyArray<MemoryEntry>,
  query: string,
  topK = 10,
  now = Date.now(),
): ReadonlyArray<ScoredEntry> {
  if (entries.length === 0) return []
  const qTokens = tokenize(query)
  if (qTokens.length === 0) return []
  const df = new Map<string, number>()
  const docTokens = entries.map((e) => {
    const tokens = new Set(tokenize(`${e.title} ${e.content} ${e.keywords.join(" ")}`))
    for (const t of tokens) df.set(t, (df.get(t) ?? 0) + 1)
    return { entry: e, tokens }
  })
  const N = entries.length
  const scored: ScoredEntry[] = []
  for (const { entry, tokens } of docTokens) {
    let score = 0
    for (const t of qTokens) {
      if (!tokens.has(t)) continue
      const idf = Math.log((N + 1) / ((df.get(t) ?? 0) + 1)) + 1
      score += idf
    }
    if (score > 0) {
      // time decay: halve weight for entries older than 30 days
      const ageDays = (now - entry.updated_at) / 86_400_000
      const decay = entry.status === "confirmed" ? 1 : Math.max(0.4, 1 - ageDays / 30)
      scored.push({ entry, score: score * decay })
    }
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, topK)
}
