import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { MemoryPlugin } from "@opencode-ai/core/plugin/memory/index"
import { PluginHost } from "@opencode-ai/core/plugin/host"
import { PluginV2 } from "@opencode-ai/core/plugin"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)

describe("MemoryPlugin", () => {
  it.effect("boots without error", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      const host = yield* PluginHost.make(plugin)
      yield* MemoryPlugin.Plugin.effect(host)
    }),
  )

  it.effect("context source returns empty string when no memories stored", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      const host = yield* PluginHost.make(plugin)
      yield* MemoryPlugin.Plugin.effect(host)
      const result = yield* host.context.register({
        key: "test",
        load: Effect.succeed(""),
      })
      expect(result).toBeUndefined()
    }),
  )
})
