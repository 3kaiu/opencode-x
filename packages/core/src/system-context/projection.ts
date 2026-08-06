// V2 context projection (M1 §1.3/§1.6).
// Six-layer assembly: system / world / instructions / memory / history / live.
// Pure functions: same inputs → same output (fingerprint). Each piece carries
// a SourceRef so the model can verify provenance (M1 §1.3 引用溯源).
export * as Projection from "./projection"

import { ContextBudget, type LayerName } from "./budget"
import { Isolation, type TaggedContent } from "../security/isolation"

export type SourceKind = "system" | "user" | "local-file" | "web" | "memory" | "tool-output" | "history"

export interface SourceRef {
  readonly kind: SourceKind
  readonly path?: string
  readonly line?: number
  readonly memoryID?: string
  readonly eventSeq?: number
}

export interface ProjectedPiece {
  readonly layer: LayerName
  readonly text: string
  readonly ref?: SourceRef
  readonly tagged?: TaggedContent
}

export interface ProjectionInput {
  readonly window: number
  readonly system: ReadonlyArray<ProjectedPiece>       // L0
  readonly world: ReadonlyArray<ProjectedPiece>        // L1
  readonly instructions: ReadonlyArray<ProjectedPiece> // L2
  readonly memory: ReadonlyArray<ProjectedPiece>       // L3
  readonly history: ReadonlyArray<ProjectedPiece>      // L4
  readonly live: ReadonlyArray<ProjectedPiece>         // L5
}

export interface ProjectionResult {
  readonly layers: Record<LayerName, string>
  readonly budget: ContextBudget.Budget
  readonly used: Record<LayerName, number>
  readonly fingerprint: string
  readonly dropped: ReadonlyArray<{ readonly layer: LayerName; readonly piece: ProjectedPiece; readonly reason: string }>
}

const MARKERS: Record<LayerName, string> = {
  system: "=== SYSTEM (capability, immutable) ===",
  world: "=== WORLD (environment baseline) ===",
  instructions: "=== INSTRUCTIONS (scope: session > project > global) ===",
  memory: "=== MEMORY (retrieved, relevance-ranked) ===",
  history: "=== HISTORY (recent full, older summarized) ===",
  live: "=== LIVE (current state delta) ===",
}

/** Estimates tokens cheaply: chars/4 (heuristic, matches pi fallback). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

function truncateToBudget(text: string, budget: number): { readonly text: string; readonly droppedChars: number } {
  if (text.length <= budget * 4) return { text, droppedChars: 0 }
  const keep = budget * 4
  const head = Math.floor(keep * 0.7)
  const tail = keep - head
  return {
    text: `${text.slice(0, head)}\n…[truncated: ${text.length - keep} chars omitted]…\n${text.slice(-tail)}`,
    droppedChars: text.length - keep,
  }
}

function renderPiece(piece: ProjectedPiece, refText: string | null): string {
  const body = piece.tagged ? Isolation.render(piece.tagged) : piece.text
  return refText ? `[${refText}] ${body}` : body
}

function refText(ref: SourceRef | undefined): string | null {
  if (!ref) return null
  switch (ref.kind) {
    case "local-file":
      return ref.line ? `${ref.path}:${ref.line}` : ref.path ?? "file"
    case "web":
      return ref.path ?? "web"
    case "memory":
      return `memory:${ref.memoryID ?? "?"}`
    case "tool-output":
      return `tool:${ref.eventSeq ?? "?"}`
    default:
      return null
  }
}

/**
 * Assembles the six layers honoring per-layer budgets. Layers are processed in
 * dependency order (system first, live last); when a layer's pieces exceed its
 * budget, pieces are dropped from the END (newest memory/history entries are
 * most relevant). A deterministic fingerprint over all retained text enables
 * M12 decision records and cache-friendly projection reuse.
 */
export function project(input: ProjectionInput): ProjectionResult {
  const budget = ContextBudget.allot(input.window)
  const layers = {} as Record<LayerName, string>
  const used = {} as Record<LayerName, number>
  const dropped: Array<{ layer: LayerName; piece: ProjectedPiece; reason: string }> = []

  const LAYERS: ReadonlyArray<[LayerName, ReadonlyArray<ProjectedPiece>]> = [
    ["system", input.system],
    ["world", input.world],
    ["instructions", input.instructions],
    ["memory", input.memory],
    ["history", input.history],
    ["live", input.live],
  ]

  for (const [layer, pieces] of LAYERS) {
    const cap = budget.layers[layer]
    let out: string[] = []
    let usedTokens = 0
    if (pieces.length > 0) out.push(MARKERS[layer])
    for (const piece of pieces) {
      const rendered = renderPiece(piece, refText(piece.ref))
      const cost = estimateTokens(rendered)
      if (usedTokens + cost > cap && usedTokens > 0) {
        dropped.push({ layer, piece, reason: `exceeds ${layer} budget (${cap})` })
        continue
      }
      if (usedTokens + cost > cap) {
        // single oversized piece: truncate to fit, keep head+tail
        const { text } = truncateToBudget(rendered, cap - usedTokens)
        out.push(text)
        usedTokens = cap
        break
      }
      out.push(rendered)
      usedTokens += cost
    }
    const joined = out.join("\n")
    layers[layer] = joined
    used[layer] = usedTokens
  }

  const fingerprint = fingerprintOf(layers)
  return { layers, budget, used, fingerprint, dropped }
}

/** Deterministic fingerprint: stable hash over retained layer text. */
export function fingerprintOf(layers: Record<LayerName, string>): string {
  let hash = 0
  for (const layer of ["system", "world", "instructions", "memory", "history", "live"] as ReadonlyArray<LayerName>) {
    const text = layers[layer]
    for (let i = 0; i < text.length; i++) {
      hash = (hash * 31 + text.charCodeAt(i)) | 0
    }
    hash = (hash * 31 + layer.length) | 0
  }
  return `v2:${(hash >>> 0).toString(16)}`
}

/** Convenience: piece builders. */
export const piece = {
  system: (text: string): ProjectedPiece => ({ layer: "system", text }),
  world: (text: string, path?: string): ProjectedPiece => ({
    layer: "world",
    text,
    ref: path ? { kind: "local-file", path } : undefined,
  }),
  instruction: (text: string): ProjectedPiece => ({ layer: "instructions", text }),
  memory: (text: string, memoryID: string): ProjectedPiece => ({
    layer: "memory",
    text,
    ref: { kind: "memory", memoryID },
  }),
  history: (text: string, ref?: SourceRef): ProjectedPiece => ({ layer: "history", text, ref }),
  live: (text: string, eventSeq?: number): ProjectedPiece => ({
    layer: "live",
    text,
    ref: eventSeq !== undefined ? { kind: "tool-output", eventSeq } : undefined,
  }),
  data: (text: string, source: "local-file" | "web" | "tool-output", path?: string): ProjectedPiece => {
    const tagged = Isolation.tag(text, source)
    const layer: LayerName = source === "web" ? "live" : "history"
    return {
      layer,
      text,
      tagged,
      ref: { kind: source, path },
    }
  },
}
