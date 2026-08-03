export * as SessionHooks from "./hooks"

import { Context, Effect, Layer, Ref, Scope } from "effect"
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

export type TurnStartResult =
  | { readonly action: "continue" }
  | { readonly action: "block"; readonly feedback: string }

export type TurnStartHook = (turn: { readonly prompt: string }) => Effect.Effect<TurnStartResult>

export type TurnStopHook = (turn: { readonly prompt: string; readonly stopReason: string }) => Effect.Effect<void>

export interface Interface {
  readonly registerPreToolUse: (hook: PreToolUseHook) => Effect.Effect<void, never, Scope.Scope>
  readonly registerPostToolUse: (hook: PostToolUseHook) => Effect.Effect<void, never, Scope.Scope>
  readonly runPreToolUse: (tool: {
    readonly name: string
    readonly input: unknown
  }) => Effect.Effect<PreToolUseResult>
  readonly runPostToolUse: (tool: {
    readonly name: string
    readonly input: unknown
    readonly output: unknown
  }) => Effect.Effect<PostToolUseResult>
  /** Turn-level lifecycle (Claude Code UserPromptSubmit/Stop): runs before the provider request and after the turn settles. */
  readonly registerTurnStart: (hook: TurnStartHook) => Effect.Effect<void, never, Scope.Scope>
  readonly registerTurnStop: (hook: TurnStopHook) => Effect.Effect<void, never, Scope.Scope>
  readonly runTurnStart: (turn: { readonly prompt: string }) => Effect.Effect<TurnStartResult>
  readonly runTurnStop: (turn: { readonly prompt: string; readonly stopReason: string }) => Effect.Effect<void>
  /** Session-level lifecycle (Claude Code SessionStart/End): once per active drain window. */
  readonly registerSessionStart: (hook: () => Effect.Effect<void>) => Effect.Effect<void, never, Scope.Scope>
  readonly registerSessionEnd: (hook: () => Effect.Effect<void>) => Effect.Effect<void, never, Scope.Scope>
  readonly runSessionStart: () => Effect.Effect<void>
  readonly runSessionEnd: () => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/SessionHooks") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const preHooks = yield* Ref.make<ReadonlyArray<PreToolUseHook>>([])
    const postHooks = yield* Ref.make<ReadonlyArray<PostToolUseHook>>([])
    const turnStartHooks = yield* Ref.make<ReadonlyArray<TurnStartHook>>([])
    const turnStopHooks = yield* Ref.make<ReadonlyArray<TurnStopHook>>([])
    const sessionStartHooks = yield* Ref.make<ReadonlyArray<() => Effect.Effect<void>>>([])
    const sessionEndHooks = yield* Ref.make<ReadonlyArray<() => Effect.Effect<void>>>([])

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
        yield* Effect.addFinalizer(() => Ref.update(preHooks, (current) => current.filter((item) => item !== hook)))
      }),
      registerPostToolUse: Effect.fn("SessionHooks.registerPostToolUse")(function* (hook: PostToolUseHook) {
        yield* Ref.update(postHooks, (current) => [...current, hook])
        yield* Effect.addFinalizer(() => Ref.update(postHooks, (current) => current.filter((item) => item !== hook)))
      }),
      registerTurnStart: Effect.fn("SessionHooks.registerTurnStart")(function* (hook: TurnStartHook) {
        yield* Ref.update(turnStartHooks, (current) => [...current, hook])
        yield* Effect.addFinalizer(() => Ref.update(turnStartHooks, (current) => current.filter((item) => item !== hook)))
      }),
      registerTurnStop: Effect.fn("SessionHooks.registerTurnStop")(function* (hook: TurnStopHook) {
        yield* Ref.update(turnStopHooks, (current) => [...current, hook])
        yield* Effect.addFinalizer(() => Ref.update(turnStopHooks, (current) => current.filter((item) => item !== hook)))
      }),
      runPreToolUse,
      runPostToolUse,
      registerSessionStart: Effect.fn("SessionHooks.registerSessionStart")(function* (hook: () => Effect.Effect<void>) {
        yield* Ref.update(sessionStartHooks, (current) => [...current, hook])
        yield* Effect.addFinalizer(() =>
          Ref.update(sessionStartHooks, (current) => current.filter((item) => item !== hook)),
        )
      }),
      registerSessionEnd: Effect.fn("SessionHooks.registerSessionEnd")(function* (hook: () => Effect.Effect<void>) {
        yield* Ref.update(sessionEndHooks, (current) => [...current, hook])
        yield* Effect.addFinalizer(() => Ref.update(sessionEndHooks, (current) => current.filter((item) => item !== hook)))
      }),
      runSessionStart: Effect.fn("SessionHooks.runSessionStart")(function* () {
        const hooks = yield* Ref.get(sessionStartHooks)
        for (const hook of hooks) yield* hook()
      }),
      runSessionEnd: Effect.fn("SessionHooks.runSessionEnd")(function* () {
        const hooks = yield* Ref.get(sessionEndHooks)
        for (const hook of hooks) yield* hook()
      }),
      runTurnStart: Effect.fn("SessionHooks.runTurnStart")(function* (turn: { readonly prompt: string }) {
        const hooks = yield* Ref.get(turnStartHooks)
        if (hooks.length === 0) return { action: "continue" as const }
        const feedback: string[] = []
        for (const hook of hooks) {
          const result = yield* hook(turn)
          if (result.action === "block" && result.feedback) feedback.push(result.feedback)
        }
        return feedback.length > 0
          ? { action: "block" as const, feedback: feedback.join("\n") }
          : { action: "continue" as const }
      }),
      runTurnStop: Effect.fn("SessionHooks.runTurnStop")(function* (turn: {
        readonly prompt: string
        readonly stopReason: string
      }) {
        const hooks = yield* Ref.get(turnStopHooks)
        for (const hook of hooks) yield* hook(turn)
      }),
    })
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [],
})
