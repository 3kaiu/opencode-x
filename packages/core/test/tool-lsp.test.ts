import fs from "fs/promises"
import path from "path"
import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Location } from "@opencode-ai/core/location"
import { LocationMutation } from "@opencode-ai/core/location-mutation"
import { Permission } from "@opencode-ai/core/permission"
import { Ripgrep } from "@opencode-ai/core/ripgrep"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { Session } from "@opencode-ai/core/session"
import { LspTool } from "@opencode-ai/core/tool/lsp"
import { ToolRegistry } from "@opencode-ai/core/tool/registry"
import { ToolOutputStore } from "@opencode-ai/core/tool-output-store"
import { location } from "./fixture/location"
import { tmpdir } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"
import { toolIdentity, settleTool } from "./lib/tool"

const sessionID = Session.ID.make("ses_lsp_tool_test")

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
      AppNodeBuilder.build(
        LayerNode.group([
          ToolRegistry.node,
          ToolRegistry.toolsNode,
          LocationMutation.node,
          Ripgrep.node,
          LspTool.node,
        ]),
        [
          [
            Location.node,
            Layer.succeed(Location.Service, Location.Service.of(location({ directory: AbsolutePath.make(directory) }))),
          ],
          [Permission.node, permission],
          [ToolOutputStore.node, ToolOutputStore.nodeWithoutConfig],
        ],
      ),
    ),
  )

const call = (input: typeof LspTool.Input.Type, id: string) => ({
  sessionID,
  ...toolIdentity,
  call: { type: "tool-call" as const, id, name: "lsp", input },
})

const it = testEffect(Layer.empty)

describe("LspTool", () => {
  it.live("extracts symbol declarations with action: symbols", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => {
        const file = path.join(tmp.path, "example.ts")
        const code = [
          "export const CONFIG = { timeout: 1000 }",
          "export function calculateTotal(a: number, b: number): number {",
          "  return a + b",
          "}",
          "export class OrderManager {",
          "  process() {}",
          "}",
        ].join("\n")

        return Effect.promise(() => fs.writeFile(file, code)).pipe(
          Effect.andThen(
            withTool(tmp.path, (registry) =>
              Effect.gen(function* () {
                const settled = yield* settleTool(
                  registry,
                  call({ action: "symbols", path: "example.ts" }, "call-symbols"),
                )
                expect(settled.result.type).toBe("text")
                const out = settled.output?.structured as typeof LspTool.Output.Type
                expect(out.action).toBe("symbols")
                expect(out.results.length).toBe(3)
                expect(out.results.map((r) => r.snippet)).toContain("export const CONFIG = { timeout: 1000 }")
                expect(out.results.map((r) => r.snippet)).toContain("export class OrderManager {")
              }),
            ),
          ),
        )
      },
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
  )

  it.live("finds definition of a declared symbol with action: definition", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => {
        const file = path.join(tmp.path, "math.ts")
        const code = [
          "const PI = 3.14159",
          "function computeCircleArea(r: number) {",
          "  return PI * r * r",
          "}",
        ].join("\n")

        return Effect.promise(() => fs.writeFile(file, code)).pipe(
          Effect.andThen(
            withTool(tmp.path, (registry) =>
              Effect.gen(function* () {
                const settled = yield* settleTool(
                  registry,
                  call({ action: "definition", path: "math.ts", symbol: "computeCircleArea" }, "call-def"),
                )
                expect(settled.result.type).toBe("text")
                const out = settled.output?.structured as typeof LspTool.Output.Type
                expect(out.action).toBe("definition")
                expect(out.results.length).toBe(1)
                expect(out.results[0].line).toBe(2)
              }),
            ),
          ),
        )
      },
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
  )

  it.live("finds references across files with action: references", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => {
        const fileA = path.join(tmp.path, "user.ts")
        const fileB = path.join(tmp.path, "service.ts")
        const codeA = "export interface UserProfile { name: string }"
        const codeB = "import { UserProfile } from './user'\nconst u: UserProfile = { name: 'Alice' }"

        return Effect.promise(() => Promise.all([fs.writeFile(fileA, codeA), fs.writeFile(fileB, codeB)])).pipe(
          Effect.andThen(
            withTool(tmp.path, (registry) =>
              Effect.gen(function* () {
                const settled = yield* settleTool(
                  registry,
                  call({ action: "references", path: "user.ts", symbol: "UserProfile" }, "call-refs"),
                )
                expect(settled.result.type).toBe("text")
                const out = settled.output?.structured as typeof LspTool.Output.Type
                expect(out.action).toBe("references")
                expect(out.results.length).toBeGreaterThanOrEqual(2)
              }),
            ),
          ),
        )
      },
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
  )

  it.live("reports diagnostics with action: diagnostics", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => {
        const file = path.join(tmp.path, "todo.ts")
        const code = [
          "function legacyAuth() {",
          "  // TODO: deprecate this in v3",
          "  return true",
          "}",
        ].join("\n")

        return Effect.promise(() => fs.writeFile(file, code)).pipe(
          Effect.andThen(
            withTool(tmp.path, (registry) =>
              Effect.gen(function* () {
                const settled = yield* settleTool(
                  registry,
                  call({ action: "diagnostics", path: "todo.ts" }, "call-diag"),
                )
                expect(settled.result.type).toBe("text")
                const out = settled.output?.structured as typeof LspTool.Output.Type
                expect(out.action).toBe("diagnostics")
                expect(out.diagnostics?.length).toBe(1)
                expect(out.diagnostics?.[0].line).toBe(2)
              }),
            ),
          ),
        )
      },
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
  )
})
