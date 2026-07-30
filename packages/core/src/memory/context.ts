export * as MemoryContext from "./context"

import { Effect, Layer, Schema } from "effect"
import { SystemContext } from "../system-context"
import { SystemContextRegistry } from "../system-context/registry"
import { makeLocationNode } from "../effect/app-node"
import { getIndex } from "./store"

const formatMemories = (
  index: ReadonlyArray<{ id: string; category: string; title: string; keywords: ReadonlyArray<string> }>,
): string => {
  if (index.length === 0) return ""
  const lines = index.map((m) => `- [${m.category}] ${m.title} (keywords: ${m.keywords.join(", ")})`)
  return `<memories>\n${lines.join("\n")}\n</memories>`
}

const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const registry = yield* SystemContextRegistry.Service

    const context = SystemContext.make({
      key: SystemContext.Key.make("core/memory"),
      codec: Schema.toCodecJson(Schema.String),
      load: Effect.promise(getIndex).pipe(
        Effect.map((index) => {
          if (index.length === 0) return SystemContext.unavailable
          return formatMemories(index)
        }),
      ),
      baseline: (text) => text,
      update: (_previous, text) => text,
    })

    yield* registry.register({ key: SystemContext.Key.make("core/memory"), load: Effect.succeed(context) })
  }),
)

export const node = makeLocationNode({
  name: "memory-context",
  layer,
  deps: [SystemContextRegistry.node],
})
