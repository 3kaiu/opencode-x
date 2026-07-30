export * as SpawnAgentTool from "./spawn-agent"

import { ToolFailure } from "@opencode-ai/llm"
import { Effect, Layer, Schema } from "effect"
import { makeLocationNode } from "../effect/app-node"
import { SubagentDepth } from "../subagent/depth"
import { SubagentSpawner } from "../subagent/spawner"
import type { SubAgentType } from "../subagent/registry"
import { ToolRegistry } from "./registry"
import { Tool } from "./tool"
import { Tools } from "./tools"

export const name = "spawn_agent"

export const Input = Schema.Struct({
  type: Schema.Literals(["coder", "explore", "plan"]).annotate({
    description: "The type of sub-agent to spawn",
  }),
  task: Schema.String.annotate({ description: "The task description for the sub-agent to execute" }),
  model: Schema.optional(
    Schema.String.annotate({
      description: "Model to use. Use 'inherit' to share parent's model for cache alignment",
    }),
  ),
})

export const Output = Schema.Struct({
  output: Schema.String,
  success: Schema.Boolean,
  error: Schema.optional(Schema.String),
  tokensUsed: Schema.optional(Schema.Number),
})

export const description = [
  "Spawn an isolated sub-agent as a child process to handle a specific task.",
  "",
  "The sub-agent runs in its own Bun process with crash isolation.",
  "Available types:",
  "  - coder: General-purpose coding agent (read, write, edit, bash, grep, glob)",
  "  - explore: Read-only codebase exploration (read, grep, glob)",
  "  - plan: Architecture design and planning (read, grep, glob)",
  "",
  "Use model:'inherit' for cache alignment with the parent.",
  "Max nesting depth is 3 levels.",
].join("\n")

const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const tools = yield* Tools.Service

    yield* tools
      .register({
        [name]: Tool.make({
          description,
          input: Input,
          output: Output,
          execute: (input) =>
            Effect.gen(function* () {
              if (!SubagentDepth.canSpawn()) {
                return yield* Effect.fail(
                  new ToolFailure({
                    message: `Cannot spawn sub-agent: max nesting depth (${SubagentDepth.MAX_NESTING_DEPTH}) reached`,
                  }),
                )
              }

              const result = yield* SubagentSpawner.spawnSubAgent({
                type: input.type as SubAgentType,
                task: input.task,
                model: input.model,
              })

              if (!result.success) {
                return yield* Effect.fail(
                  new ToolFailure({
                    message: result.error ?? "Sub-agent execution failed",
                  }),
                )
              }

              return result
            }),
          toModelOutput: ({ output }) => {
            const status = output.success ? "completed" : "failed"
            const header = `[Sub-agent ${status}]`
            const body = output.success ? output.output : (output.error ?? "Unknown error")
            return [{ type: "text", text: `${header}\n\n${body}` }]
          },
        }),
      })
      .pipe(Effect.orDie)
  }),
)

export const node = makeLocationNode({
  name: "tool/spawn-agent",
  layer,
  deps: [ToolRegistry.node],
})
