import { Effect, Option } from "effect"
import { ContextBudget } from "../../system-context/budget"
import { Memory } from "../../memory/store"
import { MemoryInject } from "../../memory/inject"
import { Projection } from "../../system-context/projection"
import { Observability } from "@opencode-ai/observability"

// L3 memory layer (P1.4): retrieves confirmed V2 memory entries for the current
// prompt, caps them at the projection budget for the model window, and renders
// them with `memory:<id>` provenance refs matching the Projection markers.
// Returns undefined when nothing qualifies so the system layer stays unchanged.
const DEFAULT_MEMORY_TOP_K = 5
const DEFAULT_MEMORY_WINDOW = 128_000

export const retrieveMemoryLayer = Effect.fn("SessionRunner.retrieveMemoryLayer")(function* (
  store: Memory.MemoryStore,
  query: string,
  window: number | undefined,
) {
  const observability = Option.getOrUndefined(yield* Effect.serviceOption(Observability))
  const entries = [...(yield* Effect.promise(() => Memory.replayWire(store))).values()].filter(
    (entry) => entry.status === "confirmed",
  )
  if (entries.length === 0) return undefined
  const windowTokens = window !== undefined && window > 0 ? window : DEFAULT_MEMORY_WINDOW
  const budget = ContextBudget.allot(windowTokens).layers.memory
  const result = MemoryInject.inject(entries, { query: query.trim(), topK: DEFAULT_MEMORY_TOP_K, budget })
  observability?.record("counter", "memory.inject.hits", { count: String(result.pieces.length) }, 1)
  if (result.droppedCount > 0) {
    observability?.record("counter", "memory.inject.dropped", { count: String(result.droppedCount) }, 1)
  }
  if (result.pieces.length === 0) return undefined
  const projected = Projection.project({
    window: windowTokens,
    system: [],
    world: [],
    instructions: [],
    memory: result.pieces.map((piece) => Projection.piece.memory(piece.text, piece.ref?.memoryID ?? "?")),
    history: [],
    live: [],
  })
  observability?.record("gauge", "projection.memory.used", { window: String(windowTokens) }, projected.used.memory)
  if (projected.dropped.length > 0) {
    observability?.record("counter", "projection.memory.dropped", { count: String(projected.dropped.length) }, 1)
  }
  const body = projected.layers.memory.split("\n").slice(1).join("\n")
  if (body.length === 0) return undefined
  return `=== MEMORY (retrieved, relevance-ranked) ===\n${body}`
})
