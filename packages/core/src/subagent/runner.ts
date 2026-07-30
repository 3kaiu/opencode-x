export * as SubagentRunner from "./runner"

import { LLM, LLMClient, LLMEvent, Message } from "@opencode-ai/llm"
import { Context, DateTime, Effect, Layer, Schema } from "effect"
import { Stream } from "effect"
import { eq } from "drizzle-orm"
import { AgentV2 } from "../agent"
import { Database } from "../database/database"
import { makeLocationNode } from "../effect/app-node"
import { llmClient } from "../effect/app-node-platform"
import { PermissionV2 } from "../permission"
import { SessionSchema } from "../session/schema"
import { SessionTable, SessionMessageTable } from "../session/sql"
import { SessionStore } from "../session/store"
import { ToolRegistry } from "../tool/registry"
import { SessionRunnerModel } from "../session/runner/model"
import { SubagentLimiter } from "./limiter"
import type { Coordinator as SubagentCoordinatorType } from "./coordinator"
import { Service as EventV2Service, node as EventV2Node } from "../bus"
import { SessionEvent } from "@opencode-ai/schema/session-event"

export const Status = Schema.Literals(["completed", "partial"])

export const DEFAULT_SUBAGENT_STEPS = 5

export const SUBAGENT_READONLY_RULES: PermissionV2.Ruleset = [
  { action: "read", effect: "allow", resource: "*" },
  { action: "grep", effect: "allow", resource: "*" },
  { action: "glob", effect: "allow", resource: "*" },
  { action: "web_search", effect: "allow", resource: "*" },
  { action: "web_fetch", effect: "allow", resource: "*" },
  { action: "skill", effect: "allow", resource: "*" },
  { action: "question", effect: "deny", resource: "*" },
  { action: "edit", effect: "deny", resource: "*" },
  { action: "bash", effect: "deny", resource: "*" },
]

export type SubagentResult = {
  readonly sessionID: SessionSchema.ID
  readonly text: string
  readonly tokens_input: number
  readonly tokens_output: number
  readonly status: "completed" | "partial"
}

export type SubagentMode = "new" | "resume" | "fork"

export interface Interface {
  readonly run: (input: {
    readonly agentID: AgentV2.ID
    readonly task: string
    readonly context: string | undefined
    readonly parentSessionID: SessionSchema.ID
    /** Resume an existing subagent session by its ID, continuing its conversation history */
    readonly resumeSessionID?: SessionSchema.ID
    /** Fork mode: inherit parent's full conversation history instead of starting fresh */
    readonly mode?: SubagentMode
    /** Optional coordinator for tracking and managing subagent execution */
    readonly coordinator?: SubagentCoordinatorType
  }) => Effect.Effect<SubagentResult>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/SubagentRunner") {}

const withDb = <A>(effect: Effect.Effect<A, unknown, unknown>) =>
  effect.pipe(Effect.catch(() => Effect.die("subagent DB operation failed")))

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const db = (yield* Database.Service).db
    const llm = yield* LLMClient.Service
    const agents = yield* AgentV2.Service
    const tools = yield* ToolRegistry.Service
    const models = yield* SessionRunnerModel.Service
    const store = yield* SessionStore.Service
    const events = yield* EventV2Service

    const run: Interface["run"] = (input) =>
      SubagentLimiter.withLimit(
        input.parentSessionID,
        Effect.gen(function* () {
          const maxDepth = 10
          let depth = 0
          let current = input.parentSessionID
          while (depth < maxDepth) {
            const session = yield* store.get(current)
            if (!session?.parentID) break
            current = session.parentID
            depth++
          }

          const agent = yield* agents.get(input.agentID).pipe(
            Effect.catch(() => Effect.die(`subagent agent not found: ${input.agentID}`)),
          )
          if (!agent) return yield* Effect.die(`subagent agent not found: ${input.agentID}`)

          const parent = yield* store.get(input.parentSessionID).pipe(
            Effect.catch(() => Effect.die(`parent session not found: ${input.parentSessionID}`)),
          )
          if (!parent) return yield* Effect.die(`parent session not found: ${input.parentSessionID}`)

          // Helper to execute LLM loop with optional coordinator tracking
          const executeWithCoordinator = <E, R>(
            sessionID: SessionSchema.ID,
            execution: Effect.Effect<void, E, R>,
          ): Effect.Effect<void, E, R> => {
            if (input.coordinator) {
              return Effect.gen(function* () {
                yield* input.coordinator!.register(sessionID)
                try {
                  return yield* execution
                } finally {
                  yield* input.coordinator!.unregister(sessionID)
                }
              }) as Effect.Effect<void, E, R>
            }
            return execution
          }

          // Resume mode: continue an existing subagent session
          if (input.resumeSessionID) {
            const resumeID = input.resumeSessionID
            const existingSession = yield* store.get(resumeID).pipe(
              Effect.catch(() => Effect.die(`resume session not found: ${resumeID}`)),
            )
            if (!existingSession) return yield* Effect.die(`resume session not found: ${resumeID}`)

            // Load existing messages from the session
            const existingMessages = yield* db
              .select()
              .from(SessionMessageTable)
              .where(eq(SessionMessageTable.session_id, resumeID))
              .all()
              .pipe(Effect.orDie)

            // Reconstruct history from existing messages
            const history: any[] = []
            for (const msg of existingMessages) {
              const data = msg.data as any
              if (msg.type === "user") {
                history.push(Message.user(data.text ?? ""))
              } else if (msg.type === "assistant") {
                const content = data.content ?? []
                const textParts = content
                  .filter((c: any) => c.type === "text")
                  .map((c: any) => ({ type: "text" as const, text: c.text ?? "" }))
                if (textParts.length > 0) {
                  history.push(Message.assistant(textParts))
                }
              }
            }

            // Add the new task as a follow-up
            history.push(Message.user(input.task))

            const model = yield* models.resolve(parent).pipe(
              Effect.catch(() => Effect.die("subagent model resolution failed")),
            )

            const permissions = agent.permissions.length > 0 ? agent.permissions : SUBAGENT_READONLY_RULES
            const materialization = yield* tools.materialize(permissions)
            const agentSteps = agent.steps ?? DEFAULT_SUBAGENT_STEPS

            let totalTokensInput = 0
            let totalTokensOutput = 0
            const textChunks: string[] = []
            let completed = false

            const mainWork = Effect.gen(function* () {
              for (let step = 0; step < agentSteps; step++) {
                const request = LLM.request({
                  model,
                  system: agent.system ? [{ type: "text" as const, text: agent.system }] : [],
                  messages: history,
                  tools: materialization.definitions,
                })

                const collected = yield* Stream.runCollect(llm.stream(request))

                for (const event of collected) {
                  if (LLMEvent.is.textDelta(event)) textChunks.push(event.text)
                  if (LLMEvent.is.finish(event)) {
                    totalTokensInput += event.usage?.inputTokens ?? 0
                    totalTokensOutput += event.usage?.outputTokens ?? 0
                  }
                }

                const toolCalls = collected.filter(LLMEvent.is.toolCall).filter((e) => !e.providerExecuted)
                if (toolCalls.length === 0) {
                  completed = true
                  break
                }

                history.push(
                  Message.assistant(
                    toolCalls.map((call) => ({
                      type: "tool-call" as const,
                      id: call.id,
                      name: call.name,
                      input: call.input,
                    })),
                  ),
                )

                for (const call of toolCalls) {
                  const settlement = yield* materialization
                    .settle({
                      sessionID: resumeID,
                      agent: input.agentID,
                      assistantMessageID: call.id as any,
                      call,
                    })
                    .pipe(
                      Effect.catch((error) =>
                        Effect.succeed({
                          result: { type: "error" as const, value: `Tool ${call.name} error: ${String(error)}` },
                        }),
                      ),
                    )
                  history.push(Message.tool({ id: call.id, name: call.name, result: settlement.result }))
                }
              }
            })

            yield* executeWithCoordinator(resumeID, mainWork)

            const finalText = textChunks.join("")

            // Append the new assistant message
            const now = Date.now()
            yield* withDb(
              db
                .insert(SessionMessageTable)
                .values({
                  id: `msg_subagent_${now}_resume` as any,
                  session_id: resumeID as any,
                  type: "assistant",
                  seq: existingMessages.length,
                  time_created: now,
                  data: {
                    content: [{ type: "text", id: `text_resume_${now}`, text: finalText }],
                    agent: input.agentID,
                    finish: "stop",
                  } as any,
                })
                .run(),
            )

            // Update token counts
            const existingInput = (existingSession as any).tokens_input ?? 0
            const existingOutput = (existingSession as any).tokens_output ?? 0
            yield* withDb(
              db
                .update(SessionTable)
                .set({
                  tokens_input: existingInput + totalTokensInput,
                  tokens_output: existingOutput + totalTokensOutput,
                  time_updated: Date.now(),
                } as any)
                .where(eq(SessionTable.id, resumeID as any))
                .run(),
            ).pipe(Effect.catch(() => Effect.void))

            const result = {
              sessionID: resumeID,
              text: finalText,
              tokens_input: totalTokensInput,
              tokens_output: totalTokensOutput,
              status: completed ? "completed" : "partial",
            } as SubagentResult

            // Emit Subagent.Completed event to parent session's event stream
            yield* events.publish(SessionEvent.Subagent.Completed, {
              timestamp: yield* DateTime.now,
              sessionID: input.parentSessionID,
              subagentSessionID: resumeID,
              status: result.status,
              tokens: {
                input: totalTokensInput,
                output: totalTokensOutput,
              },
            })

            return result
          }

          // New session mode
          const childSessionID = SessionSchema.ID.descending()
          const now = yield* DateTime.now

          yield* withDb(
            db
              .insert(SessionTable)
              .values({
                id: childSessionID as any,
                project_id: parent.projectID as any,
                parent_id: parent.id,
                slug: `subagent-${input.agentID}`,
                title: input.task.length > 80 ? input.task.slice(0, 80) + "..." : input.task,
                directory: parent.location.directory as any,
                path: parent.subpath ?? null,
                agent: input.agentID,
                version: "2",
                time_created: now,
                time_updated: now,
                cost: 0,
                tokens_input: 0,
                tokens_output: 0,
                tokens_reasoning: 0,
                tokens_cache_read: 0,
                tokens_cache_write: 0,
              } as any)
              .run(),
          )

          // Emit Subagent.Spawned event to parent session's event stream
          yield* events.publish(SessionEvent.Subagent.Spawned, {
            timestamp: now,
            sessionID: input.parentSessionID,
            subagentSessionID: childSessionID,
            agent: input.agentID,
            task: input.task,
            mode: input.mode ?? "new",
          })

          const model = yield* models.resolve(parent).pipe(
            Effect.catch(() => Effect.die("subagent model resolution failed")),
          )

          const permissions = agent.permissions.length > 0 ? agent.permissions : SUBAGENT_READONLY_RULES
          const materialization = yield* tools.materialize(permissions)
          const agentSteps = agent.steps ?? DEFAULT_SUBAGENT_STEPS

          const history: any[] = []

          // Fork mode: inherit parent's full conversation history
          if (input.mode === "fork") {
            const parentMessages = yield* db
              .select()
              .from(SessionMessageTable)
              .where(eq(SessionMessageTable.session_id, input.parentSessionID))
              .all()
              .pipe(Effect.orDie)

            for (const msg of parentMessages) {
              const data = msg.data as any
              if (msg.type === "user") {
                history.push(Message.user(data.text ?? ""))
              } else if (msg.type === "assistant") {
                const content = data.content ?? []
                const textParts = content
                  .filter((c: any) => c.type === "text")
                  .map((c: any) => ({ type: "text" as const, text: c.text ?? "" }))
                if (textParts.length > 0) {
                  history.push(Message.assistant(textParts))
                }
              }
            }
          } else {
            // Normal mode: start with context and task
            if (input.context) history.push(Message.user(`[Context from parent]\n\n${input.context}`))
          }
          history.push(Message.user(input.task))

        let totalTokensInput = 0
        let totalTokensOutput = 0
        const textChunks: string[] = []
        let completed = false

        const mainWork = Effect.gen(function* () {
          for (let step = 0; step < agentSteps; step++) {
            const request = LLM.request({
              model,
              system: agent.system ? [{ type: "text" as const, text: agent.system }] : [],
              messages: history,
              tools: materialization.definitions,
            })

            const collected = yield* Stream.runCollect(llm.stream(request))

            for (const event of collected) {
              if (LLMEvent.is.textDelta(event)) textChunks.push(event.text)
              if (LLMEvent.is.finish(event)) {
                totalTokensInput += event.usage?.inputTokens ?? 0
                totalTokensOutput += event.usage?.outputTokens ?? 0
              }
            }

            const toolCalls = collected.filter(LLMEvent.is.toolCall).filter((e) => !e.providerExecuted)
            if (toolCalls.length === 0) {
              completed = true
              break
            }

            history.push(Message.assistant(
              toolCalls.map((call) => ({ type: "tool-call" as const, id: call.id, name: call.name, input: call.input })),
            ))

            for (const call of toolCalls) {
              const settlement = yield* materialization.settle({
                sessionID: childSessionID,
                agent: input.agentID,
                assistantMessageID: call.id as any,
                call,
              }).pipe(
                Effect.catch((error) =>
                  Effect.succeed({
                    result: { type: "error" as const, value: `Tool ${call.name} error: ${String(error)}` },
                  }),
                ),
              )
              history.push(Message.tool({ id: call.id, name: call.name, result: settlement.result }))
            }

            yield* withDb(
              db.update(SessionTable).set({
                tokens_input: totalTokensInput,
                tokens_output: totalTokensOutput,
                time_updated: Date.now(),
              } as any).where(eq(SessionTable.id, childSessionID as any)).run(),
            ).pipe(Effect.catch(() => Effect.void))
          }
        })

        yield* executeWithCoordinator(
          childSessionID,
          mainWork.pipe(
            Effect.onInterrupt(() =>
              withDb(
                db.update(SessionTable).set({ time_updated: Date.now() } as any)
                  .where(eq(SessionTable.id, childSessionID as any)).run(),
              ).pipe(Effect.catch(() => Effect.void)),
            ),
          ),
        )

        const finalText = textChunks.join("")

        yield* withDb(
          db.insert(SessionMessageTable).values({
            id: `msg_subagent_${now}_0`,
            session_id: childSessionID as any,
            type: "user",
            seq: 0,
            time_created: now,
            data: { text: input.task, files: [], agents: [] } as any,
          } as any).run(),
        ).pipe(Effect.catch(() => Effect.void))

        yield* withDb(
          db.insert(SessionMessageTable).values({
            id: `msg_subagent_${Date.now()}_1`,
            session_id: childSessionID as any,
            type: "assistant",
            seq: 1,
            time_created: Date.now(),
            data: {
              content: [{ type: "text", id: "text_1", text: finalText }],
              agent: input.agentID,
              finish: "stop",
            } as any,
          } as any).run(),
        ).pipe(Effect.catch(() => Effect.void))

        const result = {
          sessionID: childSessionID,
          text: finalText,
          tokens_input: totalTokensInput,
          tokens_output: totalTokensOutput,
          status: depth >= maxDepth ? "partial" : (completed ? "completed" : "partial"),
        } as SubagentResult

        // Emit Subagent.Completed event to parent session's event stream
        yield* events.publish(SessionEvent.Subagent.Completed, {
          timestamp: yield* DateTime.now,
          sessionID: input.parentSessionID,
          subagentSessionID: childSessionID,
          status: result.status,
          tokens: {
            input: totalTokensInput,
            output: totalTokensOutput,
          },
        })

        return result
        }),
      ) as Effect.Effect<SubagentResult>

    return Service.of({ run })
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [
    Database.node,
    llmClient,
    AgentV2.node,
    ToolRegistry.node,
    SessionRunnerModel.node,
    SessionStore.node,
    EventV2Node,
  ],
})
