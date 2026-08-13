import type { Effect, Scope } from "effect"

export interface ToolExecuteBeforeEvent {
  readonly name: string
  readonly input: unknown
  readonly args: {
    readonly update: (input: unknown) => void
  }
  readonly deny: (reason: string) => void
  readonly skip: () => void
}

export interface ToolExecuteAfterEvent {
  readonly name: string
  readonly input: unknown
  readonly output: unknown
  readonly context: {
    readonly add: (text: string) => void
  }
}

export interface ToolGuardEvent {
  readonly name: string
  readonly input: unknown
  readonly deny: (reason: string) => void
}

export interface ToolHooks {
  hook(
    name: "execute.before",
    callback: (event: ToolExecuteBeforeEvent) => Effect.Effect<void>,
  ): Effect.Effect<void, never, Scope.Scope>
  hook(
    name: "execute.after",
    callback: (event: ToolExecuteAfterEvent) => Effect.Effect<void>,
  ): Effect.Effect<void, never, Scope.Scope>
  hook(
    name: "guard",
    callback: (event: ToolGuardEvent) => Effect.Effect<void>,
  ): Effect.Effect<void, never, Scope.Scope>
}
