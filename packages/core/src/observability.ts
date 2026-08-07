export * as Observability from "./observability"

import { NodeFileSystem } from "@effect/platform-node"
import { LayerNode } from "./effect/layer-node"
import { Effect, Layer, Logger, References } from "effect"
import { EffectLogger, EffectTracer } from "@opencode-ai/observability"

export const layer = Layer.unwrap(
  Effect.gen(function* () {
    const logs = Logger.layer([...EffectLogger.loggers()], { mergeWithExisting: false }).pipe(
      Layer.provide(NodeFileSystem.layer),
      Layer.orDie,
      Layer.merge(Layer.succeed(References.MinimumLogLevel, EffectLogger.minimumLogLevel())),
      Layer.merge(EffectTracer.layer),
    )
    return logs
  }),
)

export const node = LayerNode.make({ name: "observability", layer, deps: [] })