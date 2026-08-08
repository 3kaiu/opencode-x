export * as SubagentRunner from "./runner"

import { Context, DateTime, Duration, Effect, Fiber, Layer, Option, Schema } from "effect"
import { Stream } from "effect"
import { AgentV2 } from "../agent"
import { makeLocationNode } from "../effect/app-node"
import { PermissionV2 } from "../permission"
import { SessionSchema } from "../session/schema"
import { SessionStore } from "../session/store"
import { SessionToolPermissions } from "../session/tool-permissions"
import { SubagentLimiter } from "./limiter"
import { SubagentAgents } from "./agents"
import { Service as EventV2Service, node as EventV2Node } from "../bus"
import { SessionEvent } from "@opencode-ai/schema/session-event"

export const Status = Schema.Literals(["completed", "partial", "running"])

// Foreground Result wait cap. The executor bounds child runs at ~10 minutes (SubagentExecutor's
// wait timeout) and settles the requester either way, so an 11-minute cap only fires if the
// Requested event was lost — turning a would-be permanent hang into a clean failure.
const RESULT_TIMEOUT = Duration.minutes(11)

const BACKGROUND_STARTED =
  "The subagent is working in the background. You will be notified automatically when it finishes. DO NOT sleep, poll, or proactively check on its progress."

// Read-only default for subagents without explicit permissions. The default-deny
// rule is first: rule evaluation and whole-tool filtering are last-match-wins, so
// the explicit allowlist below overrides it, and any action not allowlisted (e.g.
// MCP tools, task, edit) is both hidden from the model and denied at execution.
export const SUBAGENT_READONLY_RULES: PermissionV2.Ruleset = [
  { action: "*", effect: "deny", resource: "*" },
  { action: "read", effect: "allow", resource: "*" },
  { action: "grep", effect: "allow", resource: "*" },
  { action: "glob", effect: "allow", resource: "*" },
  { action: "websearch", effect: "allow", resource: "*" },
  { action: "webfetch", effect: "allow", resource: "*" },
  { action: "skill", effect: "allow", resource: "*" },
]

export type SubagentResult = {
  readonly sessionID: SessionSchema.ID
  readonly text: string
  readonly tokens_input: number
  readonly tokens_output: number
  readonly status: "completed" | "partial"
}

// The background branch returns immediately with a synthetic "running" status; it is not a real
// SubagentResult, so it keeps its own narrower type instead of widening the shared one.
export type SubagentRunningResult = Omit<SubagentResult, "status"> & { readonly status: "running" }

export interface Interface {
  readonly run: (input: {
    readonly agentID: AgentV2.ID
    readonly task: string
    readonly context: string | undefined
    readonly parentSessionID: SessionSchema.ID
    /** Run in the background: return immediately and notify the parent on completion */
    readonly background?: boolean
  }) => Effect.Effect<SubagentResult | SubagentRunningResult>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/SubagentRunner") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const agents = yield* AgentV2.Service
    yield* SubagentAgents.register()
    const store = yield* SessionStore.Service
    const events = yield* EventV2Service
    const toolPermissions = yield* SessionToolPermissions.Service

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

          // Event-decoupled durable route for new-mode subagents (the delegate_task path).
          // The child session is driven by the global SubagentExecutor through live Requested/Result
          // events, so this location-scoped runner never depends on the global SessionV2 (which would
          // form a SessionV2 -> LocationServiceMap -> location-graph layer cycle). The read-only
          // subagent default is applied via the per-session permission override the durable runner
          // consults, preserving the fork's safety default under the durable pipeline.
          {
            const childSessionID = SessionSchema.ID.descending()
            const permissions = agent.permissions.length > 0 ? agent.permissions : SUBAGENT_READONLY_RULES
            yield* toolPermissions.set(childSessionID, permissions)
            const requested = (background: boolean, timestamp: DateTime.Utc) =>
              ({
                sessionID: input.parentSessionID,
                timestamp,
                subagentSessionID: childSessionID,
                agent: input.agentID,
                task: input.task,
                context: input.context,
                mode: "new",
                background,
              }) as const

            // Background mode: hand off to the global executor and return immediately. The executor
            // drives the child, tracks it as a background job, and steers the result back into the
            // parent session on completion. The read-only override set above is cleared by the
            // executor once the child drain settles.
            if (input.background === true) {
              yield* events.publish(SessionEvent.Subagent.Requested, requested(true, yield* DateTime.now))
              const running: SubagentRunningResult = {
                sessionID: childSessionID,
                text: BACKGROUND_STARTED,
                tokens_input: 0,
                tokens_output: 0,
                status: "running",
              }
              return running
            }

            const run = Effect.scoped(
              Effect.gen(function* () {
                const resultFiber = yield* events
                  .subscribe(SessionEvent.Subagent.Result)
                  .pipe(
                    Stream.filter((payload) => payload.data.subagentSessionID === childSessionID),
                    Stream.take(1),
                    Stream.runHead,
                    Effect.forkScoped,
                  )
                yield* events.publish(SessionEvent.Subagent.Requested, requested(false, yield* DateTime.now))
                const head = yield* Fiber.join(resultFiber).pipe(
                  Effect.timeoutOption(RESULT_TIMEOUT),
                  Effect.map(Option.flatten),
                )
                if (Option.isNone(head))
                  return yield* Effect.die(new Error(`Subagent ${childSessionID} returned no result`))
                return head.value.data
              }),
            )
            const result = yield* run

            return {
              sessionID: childSessionID,
              text: result.output,
              tokens_input: result.tokens.input,
              tokens_output: result.tokens.output,
              status: result.status,
            }
          }
        }),
      )

    return Service.of({ run })
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [
    AgentV2.node,
    SessionStore.node,
    SessionToolPermissions.node,
    EventV2Node,
  ],
})
