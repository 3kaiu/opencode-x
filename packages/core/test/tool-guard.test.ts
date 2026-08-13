import { describe, expect } from "bun:test"
import { Effect } from "effect"
import * as Option from "effect/Option"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { ToolGuard } from "@opencode-ai/core/tool/guard"
import { testEffect } from "./lib/effect"

const layer = AppNodeBuilder.build(LayerNode.group([ToolGuard.node]), [])
const it = testEffect(layer)

describe("ToolGuard", () => {
  it.effect("allows tool calls when no guards are registered", () =>
    Effect.gen(function* () {
      const guard = yield* ToolGuard.Service
      const result = yield* guard.check({ name: "bash", input: { command: "ls" } })
      expect(Option.isNone(result)).toBe(true)
    }))

  it.effect("denies tool calls when a guard returns Some", () =>
    Effect.gen(function* () {
      const guard = yield* ToolGuard.Service
      yield* guard.register(() => Effect.succeed(Option.some("bash is not allowed")))
      const result = yield* guard.check({ name: "bash", input: { command: "ls" } })
      expect(Option.isSome(result)).toBe(true)
      if (Option.isSome(result)) {
        expect(result.value).toBe("bash is not allowed")
      }
    }))

  it.effect("takes the first denial when multiple guards are registered", () =>
    Effect.gen(function* () {
      const guard = yield* ToolGuard.Service
      yield* guard.register(() => Effect.succeed(Option.some("first guard denies")))
      yield* guard.register(() => Effect.succeed(Option.some("second guard denies")))
      const result = yield* guard.check({ name: "bash", input: {} })
      expect(Option.isSome(result)).toBe(true)
      if (Option.isSome(result)) {
        expect(result.value).toBe("first guard denies")
      }
    }))

  it.effect("allows when all guards return None", () =>
    Effect.gen(function* () {
      const guard = yield* ToolGuard.Service
      yield* guard.register(() => Effect.succeed(Option.none()))
      yield* guard.register(() => Effect.succeed(Option.none()))
      const result = yield* guard.check({ name: "bash", input: {} })
      expect(Option.isNone(result)).toBe(true)
    }))

  it.effect("allows when the first guard allows and the second denies", () =>
    Effect.gen(function* () {
      const guard = yield* ToolGuard.Service
      yield* guard.register(() => Effect.succeed(Option.none()))
      yield* guard.register(() => Effect.succeed(Option.some("second guard denies")))
      const result = yield* guard.check({ name: "bash", input: {} })
      expect(Option.isSome(result)).toBe(true)
      if (Option.isSome(result)) {
        expect(result.value).toBe("second guard denies")
      }
    }))

  it.effect("degrades to allow when a guard throws", () =>
    Effect.gen(function* () {
      const guard = yield* ToolGuard.Service
      yield* guard.register(() => Effect.die("guard crashed"))
      const result = yield* guard.check({ name: "bash", input: {} })
      expect(Option.isNone(result)).toBe(true)
    }))

  it.effect("supports conditional denial based on tool input", () =>
    Effect.gen(function* () {
      const guard = yield* ToolGuard.Service
      yield* guard.register((tool) => {
        const input = tool.input as { command?: string }
        if (input.command?.includes("rm -rf")) {
          return Effect.succeed(Option.some("destructive command not allowed"))
        }
        return Effect.succeed(Option.none())
      })
      const result1 = yield* guard.check({ name: "bash", input: { command: "ls" } })
      expect(Option.isNone(result1)).toBe(true)
      const result2 = yield* guard.check({ name: "bash", input: { command: "rm -rf /" } })
      expect(Option.isSome(result2)).toBe(true)
      if (Option.isSome(result2)) {
        expect(result2.value).toBe("destructive command not allowed")
      }
    }))
})
