import type { Effect, Scope } from "effect"
import type { Schema } from "effect"

export interface ToolConfig<Input = any, Output = any> {
  readonly description: string
  readonly input: Schema.Top
  readonly output: Schema.Top
  readonly execute: (input: Input, context: { readonly sessionID: string }) => Effect.Effect<Output>
}

export interface ToolHooks {
  readonly register: (tools: Record<string, ToolConfig>) => Effect.Effect<void, never, Scope.Scope>
}
