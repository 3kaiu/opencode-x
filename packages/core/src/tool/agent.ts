export * as AgentTool from "./agent"

import { ToolFailure } from "@opencode-ai/llm"
import { Effect, Layer, Schema } from "effect"
import { makeLocationNode } from "../effect/app-node"
import { Permission } from "../permission"
import { SubagentRunner } from "../subagent/runner"
import { ToolRegistry } from "./registry"
import { Tool } from "./tool"
import { Tools } from "./tools"

export const name = "delegate_task"

export const Input = Schema.Struct({
  agentID: Schema.String.annotate({ description: "The ID of the agent to delegate to" }),
  task: Schema.String.annotate({ description: "The task description for the sub-agent to execute" }),
  context: Schema.optional(
    Schema.String.annotate({ description: "Optional context from the parent session to provide to the sub-agent" }),
  ),
  background: Schema.optional(
    Schema.Boolean.annotate({
      description:
        "Run the sub-agent in the background and return immediately. You will be notified when it completes. DO NOT poll its progress.",
    }),
  ),
})

export const Output = Schema.Struct({
  sessionID: Schema.String,
  text: Schema.String,
  status: SubagentRunner.Status,
  tokens_input: Schema.Number,
  tokens_output: Schema.Number,
})

export const description = [
  "Delegate a task to a sub-agent and return once the sub-agent finishes.",
  "",
  "The sub-agent runs with its own session and tool access. Use this for tasks that can run independently.",
  "The calling agent waits for the sub-agent to complete before resuming.",
  "Set background=true to launch it asynchronously and return immediately; you are notified when it finishes.",
].join("\n")

const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const tools = yield* Tools.Service
    const runner = yield* SubagentRunner.Service
    const permission = yield* Permission.Service

    yield* tools
      .register({
        [name]: Tool.make({
          description,
          input: Input,
          output: Output,
          execute: (input, context) =>
            Effect.gen(function* () {
              yield* permission.assert({
                action: name,
                resources: [input.agentID],
                sessionID: context.sessionID,
                agent: context.agent,
                source: {
                  type: "tool",
                  messageID: context.assistantMessageID,
                  callID: context.toolCallID,
                },
              })

              return yield* runner.run({
                agentID: input.agentID as any,
                task: input.task,
                context: input.context,
                parentSessionID: context.sessionID,
                background: input.background,
              })
            }).pipe(
              Effect.mapError(
                (error) =>
                  new ToolFailure({
                    message: error instanceof Error ? error.message : "Sub-agent execution failed",
                  }),
              ),
            ),
          toModelOutput: ({ output }) => {
            const header =
              output.status === "completed"
                ? `Task completed (session ${output.sessionID})`
                : output.status === "running"
                  ? `Task running in background (session ${output.sessionID})`
                  : `Task incomplete - partial result (session ${output.sessionID})`
            return [{ type: "text", text: `${header}\n\n${output.text}` }]
          },
        }),
      })
      .pipe(Effect.orDie)
  }),
)

export const node = makeLocationNode({
  name: "tool/agent",
  layer,
  deps: [ToolRegistry.node, SubagentRunner.node, Permission.node],
})
