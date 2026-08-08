// V2 memory — retrieval-based context injection (M1 §1.3, P3.5).
// Wires the full-text search index into the projection pipeline: selects the
// top-K memory entries for a query, caps them at the layer token budget, and
// renders them as L3 `ProjectedPiece`s with provenance SourceRefs.
export * as MemoryInject from "./inject"

import { Context, Effect, Layer } from "effect"
import * as Option from "effect/Option"
import { Observability } from "@opencode-ai/observability"
import type { MemoryEntry } from "./store"
import { search, type ScoredEntry } from "./search"
import { Projection, type ProjectedPiece } from "../system-context/projection"

export interface InjectOptions {
  readonly query: string
  readonly topK: number
  /** Token budget for the whole injected layer; entries beyond it are dropped. */
  readonly budget?: number
}

export interface InjectResult {
  readonly pieces: ReadonlyArray<ProjectedPiece>
  readonly hits: ReadonlyArray<ScoredEntry>
  readonly droppedCount: number
}

/** Renders one scored memory entry as a projected piece with provenance. */
export function toPiece(entry: MemoryEntry): ProjectedPiece {
  return Projection.piece.memory(`${entry.title}: ${entry.content}`, entry.id)
}

/** Estimates tokens the same way the projection pipeline does (chars/4). */
export function estimateTokens(text: string): number {
  return Projection.estimateTokens(text)
}

/**
 * Pure selector: rank memory entries against `query`, keep the top-K that fit
 * inside the token budget (an entry that does not fit on its own is dropped).
 */
export function inject(
  entries: ReadonlyArray<MemoryEntry>,
  options: InjectOptions,
): InjectResult {
  const hits = search(entries, options.query, options.topK)
  const budget = options.budget
  const pieces: ProjectedPiece[] = []
  let used = 0
  let droppedCount = 0
  for (let i = 0; i < hits.length; i++) {
    const hit = hits[i]
    const cost = estimateTokens(`${hit.entry.title}: ${hit.entry.content}`)
    if (budget !== undefined && (cost > budget || used + cost > budget)) {
      droppedCount = hits.length - i
      break
    }
    pieces.push(toPiece(hit.entry))
    used += cost
  }
  return { pieces, hits, droppedCount }
}

export interface Interface {
  readonly inject: (
    entries: ReadonlyArray<MemoryEntry>,
    options: InjectOptions,
  ) => Effect.Effect<InjectResult>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/MemoryInject") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const record = (name: string, labels: Record<string, string>) =>
      Effect.gen(function* () {
        const observability = Option.getOrUndefined(yield* Effect.serviceOption(Observability))
        observability?.record("counter", name, labels, 1)
      })

    const injectImpl = Effect.fn("MemoryInject.inject")(function* (
      entries: ReadonlyArray<MemoryEntry>,
      options: InjectOptions,
    ) {
      const result = inject(entries, options)
      yield* record("memory.inject.hits", { count: String(result.pieces.length) })
      if (result.droppedCount > 0) {
        yield* record("memory.inject.dropped", { count: String(result.droppedCount) })
      }
      return result
    })

    return Service.of({ inject: injectImpl })
  }),
)
