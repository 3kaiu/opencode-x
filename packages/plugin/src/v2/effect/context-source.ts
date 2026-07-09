import type { Effect, Scope } from "effect"

export interface ContextSourceEntry {
  readonly key: string
  readonly load: Effect.Effect<unknown, never, Scope.Scope>
}

export interface ContextSourceHooks {
  readonly register: (entry: ContextSourceEntry) => Effect.Effect<void, never, Scope.Scope>
}
