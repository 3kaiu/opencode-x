import fs from "fs/promises"
import path from "path"
import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Location } from "@opencode-ai/core/location"
import { Permission } from "@opencode-ai/core/permission"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { Session } from "@opencode-ai/core/session"
import { GrepTool } from "@opencode-ai/core/tool/grep"
import { ToolRegistry } from "@opencode-ai/core/tool/registry"
import { ToolOutputStore } from "@opencode-ai/core/tool-output-store"
import { location } from "./fixture/location"
import { tmpdir } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"
import { toolIdentity, settleTool } from "./lib/tool"

const sessionID = Session.ID.make("ses_grep_tool_test")

const permission = Layer.succeed(
  Permission.Service,
  Permission.Service.of({
    assert: () => Effect.void,
    ask: () => Effect.die("unused"),
    reply: () => Effect.die("unused"),
    get: () => Effect.die("unused"),
    forSession: () => Effect.die("unused"),
    list: () => Effect.die("unused"),
  }),
)

const withTool = <A, E, R>(directory: string, body: (registry: ToolRegistry.Interface) => Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    return yield* body(yield* ToolRegistry.Service)
  }).pipe(
    Effect.provide(
      AppNodeBuilder.build(LayerNode.group([ToolRegistry.node, ToolRegistry.toolsNode, GrepTool.node]), [
        [
          Location.node,
          Layer.succeed(Location.Service, Location.Service.of(location({ directory: AbsolutePath.make(directory) }))),
        ],
        [Permission.node, permission],
        [ToolOutputStore.node, ToolOutputStore.nodeWithoutConfig],
      ]),
    ),
  )

const call = (input: typeof GrepTool.Input.Type, id: string) => ({
  sessionID,
  ...toolIdentity,
  call: { type: "tool-call" as const, id, name: "grep", input },
})

const matchCount = (settled: { output?: { structured?: unknown } }) =>
  Array.isArray(settled.output?.structured) ? settled.output.structured.length : -1

const it = testEffect(Layer.empty)

describe("GrepTool", () => {
  it.live("bounds matches to a sane default limit and honors explicit limits", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) =>
        Effect.gen(function* () {
          const lines = Array.from({ length: 120 }, (_, index) => `needle ${index}`).join("\n")
          yield* Effect.promise(() => fs.writeFile(path.join(tmp.path, "matches.txt"), lines + "\n"))

          yield* withTool(tmp.path, (registry) =>
            Effect.gen(function* () {
              const defaulted = yield* settleTool(registry, call({ pattern: "needle" }, "call-grep-default"))
              expect(matchCount(defaulted)).toBe(100)

              const explicit = yield* settleTool(registry, call({ pattern: "needle", limit: 7 }, "call-grep-limit"))
              expect(matchCount(explicit)).toBe(7)
            }),
          )
        }),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
  )
})
