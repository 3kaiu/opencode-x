export * as Observability from "./observability"

import fs from "fs"
import path from "path"
import { NodeFileSystem } from "@effect/platform-node"
import { LayerNode } from "./effect/layer-node"
import { Effect, Layer, Logger, References } from "effect"
import { EffectLogger, Storage, Tracer } from "@opencode-ai/observability"

// Dev-only file span exporter. Effect.withSpan instruments the whole pipeline
// (tools, session runs, npm, instance bootstrap, permissions, ...), but the
// default Tracer discards the spans. This composition-root wiring replaces the
// Tracer service and persists each ended span as one JSONL line under
// ~/.local/share/opencode/log/trace/<ts>-<pid>.jsonl so the full call tree
// (name, duration, attributes, parent span) can be profiled offline.
//
// Enable with OPENCODE_TRACE_FILE=1. Writing is fire-and-forget and guarded so
// tracing never breaks the app.

function replacer(_key: string, value: unknown) {
  if (typeof value === "bigint") return String(value)
  if (value instanceof Map) return Object.fromEntries(value)
  if (value instanceof Error) return { name: value.name, message: value.message, stack: value.stack }
  if (typeof value === "function") return "[Function]"
  return value
}

let traceFilePath: string | undefined

function traceFile() {
  if (!traceFilePath) {
    const dir = path.join(Storage.defaultLogDir(), "trace")
    fs.mkdirSync(dir, { recursive: true })
    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z")
    traceFilePath = path.join(dir, `${stamp}-${process.pid}.jsonl`)
  }
  return traceFilePath
}

const traceLayer = Tracer.layer({
  enabled: () => process.env.OPENCODE_TRACE_FILE !== undefined,
  emit: (line) => {
    try {
      fs.appendFileSync(traceFile(), JSON.stringify(line, replacer) + "\n")
    } catch {
      // never let tracing break the app
    }
  },
})

export const layer = Layer.unwrap(
  Effect.gen(function* () {
    const logs = Logger.layer([...EffectLogger.loggers()], { mergeWithExisting: false }).pipe(
      Layer.provide(NodeFileSystem.layer),
      Layer.orDie,
      Layer.merge(Layer.succeed(References.MinimumLogLevel, EffectLogger.minimumLogLevel())),
      Layer.merge(traceLayer),
    )
    return logs
  }),
)

export const node = LayerNode.make({ name: "observability", layer, deps: [] })
