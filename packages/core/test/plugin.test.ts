import { describe, expect } from "bun:test"
import { Effect, Exit, Fiber, Stream } from "effect"
import { define } from "@opencode-ai/plugin/v2/effect"
import { AgentV2 } from "@opencode-ai/core/agent"
import { Catalog } from "@opencode-ai/core/catalog"
import { EventV2 } from "@opencode-ai/core/event"
import { PluginV2 } from "@opencode-ai/core/plugin"
import { SessionHooks } from "@opencode-ai/core/session/hooks"
import { testEffect } from "./lib/effect"
import { PluginTestLayer } from "./plugin/fixture"

const it = testEffect(PluginTestLayer)

describe("PluginV2", () => {
  it.effect("waits for a plugin and returns immediately once active", () =>
    Effect.gen(function* () {
      const plugins = yield* PluginV2.Service
      const id = PluginV2.ID.make("waited")
      const waiting = yield* plugins.wait(id).pipe(Effect.forkChild)

      yield* plugins.add(id, () => Effect.void)
      yield* Fiber.join(waiting)
      yield* plugins.wait(id)
    }),
  )

  it.effect("propagates plugin activation defects to waiters", () =>
    Effect.gen(function* () {
      const plugins = yield* PluginV2.Service
      const id = PluginV2.ID.make("failed")
      const waiting = yield* plugins.wait(id).pipe(Effect.exit, Effect.forkChild)

      const added = yield* plugins.add(id, () => Effect.die("boom")).pipe(Effect.exit)
      const pending = yield* Fiber.join(waiting)
      const later = yield* plugins.wait(id).pipe(Effect.exit)

      expect(Exit.isFailure(added)).toBe(true)
      expect(Exit.isFailure(pending)).toBe(true)
      expect(Exit.isFailure(later)).toBe(true)
    }),
  )

  it.effect("adds, replaces, and removes plugins", () =>
    Effect.gen(function* () {
      const plugins = yield* PluginV2.Service
      const agents = yield* AgentV2.Service
      let description = "first"

      const managed = () =>
        define({
          id: "managed",
          effect: (ctx) =>
            ctx.agent
              .transform((agents) =>
                agents.update("configured", (agent) => {
                  agent.description = description
                }),
              )
              .pipe(Effect.asVoid),
        })

      yield* plugins.add(PluginV2.ID.make("managed"), managed().effect)

      expect((yield* agents.get(AgentV2.ID.make("configured")))?.description).toBe("first")

      description = "second"
      yield* plugins.add(PluginV2.ID.make("managed"), managed().effect)
      expect((yield* agents.get(AgentV2.ID.make("configured")))?.description).toBe("second")

      yield* plugins.remove(PluginV2.ID.make("managed"))
      expect(yield* agents.get(AgentV2.ID.make("configured"))).toBeUndefined()
    }),
  )

  it.effect("delivers encoded events to plugin subscribers", () =>
    Effect.gen(function* () {
      const plugins = yield* PluginV2.Service
      const events = yield* EventV2.Service
      let received: Array<{ id: string; type: string; properties: unknown }> = []

      const adding = yield* plugins
        .add(
          PluginV2.ID.make("subscriber"),
          define({
            id: "subscriber",
            effect: (ctx) =>
              ctx.event
                .subscribe("catalog.updated")
                .pipe(
                  Stream.take(1),
                  Stream.runCollect,
                  Effect.tap((items) => Effect.sync(() => (received = Array.from(items)))),
                  Effect.asVoid,
                ),
          }).effect,
        )
        .pipe(Effect.forkScoped)

      yield* Effect.yieldNow
      yield* events.publish(Catalog.Event.Updated, {})
      yield* Fiber.join(adding)

      expect(received[0]).toMatchObject({ type: "catalog.updated", properties: {} })
    }),
  )

  it.effect("registers tool execution hooks through the plugin context", () =>
    Effect.gen(function* () {
      const plugins = yield* PluginV2.Service
      const hooks = yield* SessionHooks.Service
      const id = PluginV2.ID.make("tool-hooks")

      yield* plugins.add(
        id,
        define({
          id: "tool-hooks",
          effect: (ctx) =>
            Effect.gen(function* () {
              yield* ctx.tool.hook("execute.before", (event) =>
                Effect.sync(() => {
                  const input = event.input as Record<string, unknown>
                  event.args.update({ ...input, patched: true })
                }),
              )
              yield* ctx.tool.hook("execute.after", (event) =>
                Effect.sync(() => {
                  event.context.add("seen:" + event.name)
                }),
              )
            }),
        }).effect,
      )

      const pre = yield* hooks.runPreToolUse({ name: "bash", input: { cmd: "ls" } })
      expect(pre).toEqual({ action: "allow", modifiedInput: { cmd: "ls", patched: true } })

      const post = yield* hooks.runPostToolUse({ name: "bash", input: {}, output: "ok" })
      expect(post).toEqual({ action: "continue", additionalContext: "seen:bash" })

      yield* plugins.remove(id)
      const cleared = yield* hooks.runPreToolUse({ name: "bash", input: { cmd: "ls" } })
      expect(cleared).toEqual({ action: "allow" })
    }),
  )
})
