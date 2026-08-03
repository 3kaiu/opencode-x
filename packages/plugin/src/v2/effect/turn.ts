import type { Effect, Scope } from "effect"

export interface TurnBeforeEvent {
  readonly prompt: string
  readonly feedback: {
    readonly add: (text: string) => void
  }
}

export interface TurnAfterEvent {
  readonly prompt: string
  readonly stopReason: string
}

export interface TurnHooks {
  hook(
    name: "before",
    callback: (event: TurnBeforeEvent) => Effect.Effect<void>,
  ): Effect.Effect<void, never, Scope.Scope>
  hook(
    name: "after",
    callback: (event: TurnAfterEvent) => Effect.Effect<void>,
  ): Effect.Effect<void, never, Scope.Scope>
}
