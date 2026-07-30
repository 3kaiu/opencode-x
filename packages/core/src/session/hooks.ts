export * as SessionHooks from "./hooks"

import { Context, Effect, Layer, Ref } from "effect"
import { makeLocationNode } from "../effect/app-node"

export type PreToolUseResult =
  | { readonly action: "allow" }
  | { readonly action: "allow"; readonly modifiedInput: unknown }
  | { readonly action: "deny"; readonly reason: string }
  | { readonly action: "skip" }

export type PostToolUseResult =
  | { readonly action: "continue" }
  | { readonly action: "continue"; readonly additionalContext: string }

export type PreToolUseHook = (tool: {
  readonly name: string
  readonly input: unknown
}) => Effect.Effect<PreToolUseResult>

export type PostToolUseHook = (tool: {
  readonly name: string
  readonly input: unknown
  readonly output: unknown
}) => Effect.Effect<PostToolUseResult>

export interface Interface {
  readonly registerPreToolUse: (hook: PreToolUseHook) => Effect.Effect<void>
  readonly registerPostToolUse: (hook: PostToolUseHook) => Effect.Effect<void>
  readonly runPreToolUse: (tool: {
    readonly name: string
    readonly input: unknown
  }) => Effect.Effect<PreToolUseResult>
  readonly runPostToolUse: (tool: {
    readonly name: string
    readonly input: unknown
    readonly output: unknown
  }) => Effect.Effect<PostToolUseResult>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/SessionHooks") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const preHooks = yield* Ref.make<ReadonlyArray<PreToolUseHook>>([])
    const postHooks = yield* Ref.make<ReadonlyArray<PostToolUseHook>>([])

    const runPreToolUse = Effect.fn("SessionHooks.runPreToolUse")(function* (tool: {
      readonly name: string
      readonly input: unknown
    }) {
      const hooks = yield* Ref.get(preHooks)
      if (hooks.length === 0) return { action: "allow" as const }
      let currentInput = tool.input
      for (const hook of hooks) {
        const result = yield* hook({ name: tool.name, input: currentInput })
        if (result.action === "deny") return result
        if (result.action === "skip") return result
        if (result.action === "allow" && "modifiedInput" in result) {
          currentInput = result.modifiedInput
        }
      }
      return currentInput === tool.input
        ? { action: "allow" as const }
        : { action: "allow" as const, modifiedInput: currentInput }
    })

    const runPostToolUse = Effect.fn("SessionHooks.runPostToolUse")(function* (tool: {
      readonly name: string
      readonly input: unknown
      readonly output: unknown
    }) {
      const hooks = yield* Ref.get(postHooks)
      if (hooks.length === 0) return { action: "continue" as const }
      const contextParts: string[] = []
      for (const hook of hooks) {
        const result = yield* hook({ name: tool.name, input: tool.input, output: tool.output })
        if ("additionalContext" in result) {
          contextParts.push(result.additionalContext)
        }
      }
      if (contextParts.length === 0) return { action: "continue" as const }
      return { action: "continue" as const, additionalContext: contextParts.join("\n") }
    })

    return Service.of({
      registerPreToolUse: Effect.fn("SessionHooks.registerPreToolUse")(function* (hook: PreToolUseHook) {
        yield* Ref.update(preHooks, (current) => [...current, hook])
      }),
      registerPostToolUse: Effect.fn("SessionHooks.registerPostToolUse")(function* (hook: PostToolUseHook) {
        yield* Ref.update(postHooks, (current) => [...current, hook])
      }),
      runPreToolUse,
      runPostToolUse,
    })
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [],
})
