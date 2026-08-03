export * as SystemContextBuiltIns from "./builtins"

import { makeLocationNode } from "../effect/app-node"
import { createHash } from "node:crypto"
import path from "node:path"
import { DateTime, Effect, Layer, Schema } from "effect"
import { Location } from "../location"
import { SystemContext } from "./index"
import { InstructionContext } from "../instruction-context"
import { SystemContextRegistry } from "./registry"
import { FSUtil } from "../fs-util"
import { Global } from "../global"
import { Memory } from "../memory/store"

// M5 → M1 L3 memory layer: confirmed lessons recorded by the V2 agent
// (sedimented failures promoted by the user) re-enter every session's system
// context, keyed to the workspace the CLI `v2` command shares. Empty libraries
// render a one-line placeholder (SystemContext requires non-empty text).
const V2_MEMORY_MAX_LESSONS = 10
const V2_MEMORY_MAX_CHARS = 240

function loadV2MemoryLessons(dataDir: string, directory: string): Effect.Effect<string> {
  const memDir = path.join(
    dataDir,
    "v2",
    createHash("sha1").update(directory).digest("hex").slice(0, 12),
  )
  return Effect.gen(function* () {
    const store = yield* Effect.promise(() => Memory.openMemory(memDir))
    const entries = [...(yield* Effect.promise(() => Memory.replayWire(store))).values()]
    const clip = (text: string) => (text.length > V2_MEMORY_MAX_CHARS ? `${text.slice(0, V2_MEMORY_MAX_CHARS)}…` : text)
    return entries
      .filter((entry) => entry.status === "confirmed")
      .sort((a, b) => b.updated_at - a.updated_at)
      .slice(0, V2_MEMORY_MAX_LESSONS)
      .map((entry) => `<lesson id="${entry.id}" category="${entry.category}">${clip(entry.content)}</lesson>`)
      .join("\n")
  })
}

const builtIns = Layer.effectDiscard(
  Effect.gen(function* () {
    const location = yield* Location.Service
    const registry = yield* SystemContextRegistry.Service
    const global = yield* Global.Service
    const environment = [
      "<env>",
      `  Working directory: ${location.directory}`,
      `  Workspace root folder: ${location.project.directory}`,
      `  Is directory a git repo: ${location.vcs?.type === "git" ? "yes" : "no"}`,
      `  Platform: ${process.platform}`,
      "</env>",
    ].join("\n")
    const context = SystemContext.combine([
      SystemContext.make({
        key: SystemContext.Key.make("core/environment"),
        codec: Schema.toCodecJson(Schema.String),
        load: Effect.succeed(environment),
        baseline: (environment) =>
          ["Here is some useful information about the environment you are running in:", environment].join("\n"),
        update: (_previous, environment) => ["The environment you are running in is now:", environment].join("\n"),
      }),
      SystemContext.make({
        key: SystemContext.Key.make("core/date"),
        codec: Schema.toCodecJson(Schema.String),
        load: DateTime.nowAsDate.pipe(Effect.map((date) => date.toDateString())),
        baseline: (date) => `Today's date: ${date}`,
        update: (_previous, date) => `Today's date is now: ${date}`,
      }),
      SystemContext.make({
        key: SystemContext.Key.make("core/v2-memory"),
        codec: Schema.toCodecJson(Schema.String),
        load: loadV2MemoryLessons(global.data, location.directory),
        baseline: (lessons) =>
          lessons.length > 0
            ? ["Here are some lessons learned from previous sessions in this workspace:", lessons].join("\n")
            : "No previous-session lessons recorded for this workspace yet.",
        update: (_previous, lessons) =>
          lessons.length > 0
            ? ["Updated lessons learned from previous sessions:", lessons].join("\n")
            : "No previous-session lessons recorded for this workspace yet.",
        removed: () => "Previous-session lessons source removed.",
      }),
    ])

    yield* registry.register({ key: SystemContext.Key.make("core/builtins"), load: Effect.succeed(context) })
  }),
)

export const node = makeLocationNode({
  name: "system-context-builtins",
  layer: builtIns,
  deps: [Location.node, SystemContextRegistry.node, InstructionContext.node, FSUtil.node, Global.node],
})
