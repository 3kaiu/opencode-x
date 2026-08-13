import path from "node:path"
import { createHash } from "node:crypto"
import { Cause, DateTime, Effect, Layer, Option, Ref, Stream } from "effect"
import { eq } from "drizzle-orm"
import { LLM, LLMClient, LLMEvent, Message, SystemPart } from "@opencode-ai/llm"
import { Global } from "../../global"
import { Snapshot } from "../../snapshot"
import { Database } from "../../database/database"
import { EventV2 } from "../../event"
import { Location } from "../../location"
import { AgentV2 } from "../../agent"
import { Config } from "../../config"
import { Catalog } from "../../catalog"
import { SystemContextRegistry } from "../../system-context/registry"
import { SkillGuidance } from "../../skill/guidance"
import { ReferenceGuidance } from "../../reference/guidance"
import { SessionHooks } from "../hooks"
import { SessionToolPermissions } from "../tool-permissions"
import { ToolRegistry } from "../../tool/registry"
import { ToolGuard } from "../../tool/guard"
import { SessionCompaction } from "../compaction"
import { SessionTodo } from "../todo"
import { SessionHistory } from "../history"
import { SessionInput } from "../input"
import { SessionMessage } from "../message"
import { SessionSchema } from "../schema"
import { SessionStore } from "../store"
import { SessionTable } from "../sql"
import { SessionEvent } from "../event"
import { type RunError, Service } from "./index"
import { RunnerGoal } from "./goal"
import { RunnerRepeatedCall } from "./repeated-call"
import { RunnerTitle } from "./title"
import { SessionRunnerModel } from "./model"
import { Goal } from "../../planning/goal"
import { Memory } from "../../memory/store"
import { makeLocationNode } from "../../effect/app-node"
import { llmClient } from "../../effect/app-node-platform"
import { retrieveMemoryLayer } from "./memory"
import { makeTurnRunner } from "./turn"

/**
 * Runs one durable coding-agent Session until it settles.
 *
 * Keep this as orchestration over smaller collaborators rather than rebuilding the legacy
 * `SessionPrompt` monolith. Implement the unchecked items in small reviewed slices:
 *
 * - Session ownership and controls
 *   - [x] Coordinate one local active drain per Session; explicit resumes join and prompt wakeups coalesce.
 *   - [ ] Replace local ownership with durable multi-node ownership when clustered.
 *   - [ ] Mark busy, retrying, idle, interrupted, or terminal-failure status durably.
 *   - [ ] Honor interruption and reject stale work after runtime attachment replacement.
 *   - [x] Honor optional agent step limits.
 *   - [x] Bound provider retries (in the LLM client) and repeated identical tool calls (here).
 *
 * - Runtime context assembly
 *   - Track V1 runtime-context parity canonically in the V3/V4 architecture docs.
 *
 * - One provider turn
 *   - [x] Translate every projected V2 Session message variant into canonical
 *     `@opencode-ai/llm` messages.
 *   - [x] Resolve policy-filtered built-in and MCP tool definitions (MCP via McpRegistration).
 *   - [ ] Resolve policy-filtered plugin and structured-output tool definitions.
 *   - [x] Stream exactly one `llm.stream(request)` provider turn.
 *   - [x] Persist assistant text and usage events incrementally as they arrive.
 *   - [ ] Persist snapshots, patches, and retry notices incrementally as they arrive.
 *   - [x] Persist reasoning, provider errors, and tool-call events incrementally as they arrive.
 *
 * - Tool settlement and continuation
 *   - [x] Durably record each tool call before side effects begin.
 *   - [x] Authorize and execute recorded local calls through a core-owned registry hook.
 *   - [x] Persist typed success, failure, and provider-executed tool outcomes.
 *   - [x] Start each recorded local call eagerly and await all settlements before continuation.
 *   - [ ] Add scoped runtime context, progress updates, attachment normalization,
 *     plugins, and cancellation settlement.
 *   - [x] Reload projected history and start the next explicit provider turn after local tool results.
 *   - [x] Continue for durable user steering accepted during an active provider turn.
 *   - [ ] Continue for compaction or another continuation condition when required.
 *
 * - Post-run maintenance
 *   - [x] Expose durable output events to replayable consumers; Step cost and token
 *     totals accumulate on the Session row through the projector.
 *   - [ ] Settle final status durably.
 *   - [ ] Coalesce streamed deltas and add covering projected-history indexes.
 *   - [x] Update the title in bounded background work after the first prompt.
 *   - [ ] Update summaries, compaction state, and cleanup in bounded background work.
 *
 * Use `llm.stream(request)` for each provider turn. Keep tool execution and continuation here.
 * Durable continuation recovery remains a separate future slice with an explicit retry policy.
 *
 * The current slice loads V2 history, translates it, resolves a model through a core service, and persists one
 * provider turn. Registry definitions are advertised, local tool calls are settled durably, and an
 * explicit loop starts the next provider turn after local settlement. Configured agent step limits bound the loop.
 */

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const events = yield* EventV2.Service
    const llm = yield* LLMClient.Service
    const agents = yield* AgentV2.Service
    const hooks = yield* SessionHooks.Service
    const guard = yield* ToolGuard.Service
    const tools = yield* ToolRegistry.Service
    const sessionToolPermissions = yield* SessionToolPermissions.Service
    const models = yield* SessionRunnerModel.Service
    const store = yield* SessionStore.Service
    const location = yield* Location.Service
    const goalService = yield* Effect.serviceOption(Goal.Service)
    const goalDrift = yield* Ref.make(new Map<string, string>())
    const systemContext = yield* SystemContextRegistry.Service
    const skillGuidance = yield* SkillGuidance.Service
    const referenceGuidance = yield* ReferenceGuidance.Service
    const catalog = yield* Catalog.Service
    const config = yield* Config.Service
    const snapshots = yield* Snapshot.Service
    const db = (yield* Database.Service).db
    const global = yield* Global.Service
    // In-memory steer signal: the hot per-event steer check reads this set
    // instead of hitting the DB on every text-end/tool-call. `admit` publishes
    // PromptAdmitted on the local bus, which this fork observes and records.
    // Drain start clears the session so stale entries from a prior drain never
    // trigger a spurious continuation; steers admitted by other processes are
    // still caught by the durable `hasPending` fallbacks at drain and turn
    // boundaries.
    const pendingSteers = yield* Ref.make<ReadonlySet<string>>(new Set())
    yield* Effect.forkScoped(
      events.subscribe(SessionEvent.PromptAdmitted).pipe(
        Stream.runForEach((event) =>
          event.data.delivery === "steer"
            ? Ref.update(pendingSteers, (current) =>
                current.has(event.data.sessionID) ? current : new Set(current).add(event.data.sessionID),
              )
            : Effect.void,
        ),
      ),
    )
    const todosService = yield* SessionTodo.Service
    const compaction = SessionCompaction.make({
      events,
      llm,
      config: yield* config.entries(),
      todos: (sessionID) => todosService.get(sessionID).pipe(Effect.catchCause(() => Effect.succeed(undefined))),
    })
    // Lazy handle to the V2 memory wire for this workspace (M5 sediment);
    // opened once per runner lifetime.
    const v2Memory = Effect.promise(() =>
      Memory.openMemory(
        path.join(
          global.data,
          "v2",
          createHash("sha1").update(location.directory).digest("hex").slice(0, 12),
        ),
      ),
    ).pipe(Effect.cached)
    const getSession = Effect.fn("SessionRunner.getSession")(function* (sessionID: SessionSchema.ID) {
      const session = yield* store.get(sessionID)
      if (!session) return yield* Effect.die(`Session not found: ${sessionID}`)
      return session
    })

    const getContext = Effect.fn("SessionRunner.getContext")(function* (sessionID: SessionSchema.ID) {
      return yield* store.context(sessionID)
    })
    const failInterruptedTools = Effect.fn("SessionRunner.failInterruptedTools")(function* (
      sessionID: SessionSchema.ID,
    ) {
      for (const message of yield* getContext(sessionID)) {
        if (message.type !== "assistant") continue
        for (const tool of message.content) {
          if (tool.type !== "tool" || (tool.state.status !== "pending" && tool.state.status !== "running")) continue
          yield* events.publish(SessionEvent.Tool.Failed, {
            sessionID,
            timestamp: yield* DateTime.now,
            assistantMessageID: message.id,
            callID: tool.id,
            error: { type: "unknown", message: "Tool execution interrupted" },
            provider: {
              executed: tool.provider?.executed === true,
              ...(tool.provider?.metadata === undefined ? {} : { metadata: tool.provider.metadata }),
            },
          })
        }
      }
    })

    const failInterruptedAssistant = Effect.fn("SessionRunner.failInterruptedAssistant")(function* (sessionID) {
      // A crashed drain leaves its assistant message uncompleted: Step.Ended/Failed
      // always projects time.completed, so any incomplete assistant at drain start
      // with a still-empty text/reasoning block is residual output from a dead
      // process. Settle it durably so clients replaying history see a terminal
      // state instead of a message stuck "generating". Tool-only residuals are
      // intentionally left open: failInterruptedTools fails the tool and the next
      // turn continues inline (hosted-tool recovery).
      for (const message of yield* getContext(sessionID)) {
        if (message.type !== "assistant" || message.time.completed) continue
        const residual = message.content.some(
          (part) => (part.type === "text" || part.type === "reasoning") && part.text === "",
        )
        if (!residual) continue
        yield* events.publish(SessionEvent.Step.Failed, {
          sessionID,
          timestamp: yield* DateTime.now,
          assistantMessageID: message.id,
          error: { type: "unknown", message: "Session interrupted: the previous run did not complete" },
        })
      }
    })

    const { runTurn, autoVerify } = makeTurnRunner({
      events,
      llm,
      agents,
      hooks,
      guard,
      tools,
      sessionToolPermissions,
      models,
      store,
      location,
      goalService,
      goalDrift,
      systemContext,
      skillGuidance,
      referenceGuidance,
      catalog,
      config,
      snapshots,
      db,
      pendingSteers,
      compaction,
      v2Memory,
      getSession,
      getContext,
    })

    const run = Effect.fn("SessionRunner.run")(function* (input: {
      readonly sessionID: SessionSchema.ID
      readonly force: boolean
    }) {
      const hasSteer = yield* SessionInput.hasPending(db, input.sessionID, "steer")
      const hasQueue = hasSteer ? false : yield* SessionInput.hasPending(db, input.sessionID, "queue")
      if (!input.force && !hasSteer && !hasQueue) return
      // Steers admitted before this drain were consumed by the durable check
      // above; reset the in-memory signal so it only reflects admits during the
      // active drain window.
      yield* Ref.update(pendingSteers, (current) => {
        if (!current.has(input.sessionID)) return current
        const next = new Set(current)
        next.delete(input.sessionID)
        return next
      })
      yield* failInterruptedTools(input.sessionID)
      yield* failInterruptedAssistant(input.sessionID)
      // Plugin session lifecycle (Claude Code SessionStart/SessionEnd): bracket
      // each active drain window. The hooks registry is process-global, so a
      // drain-wide guard is the correct unit — not a process-lifetime flag.
      // `finally` guarantees SessionEnd fires even if the drain fails or is
      // interrupted.
      Effect.runFork(hooks.runSessionStart().pipe(Effect.catch(() => Effect.void)))
      const drain = Effect.gen(function* () {
        let promotion: SessionInput.Delivery | undefined = hasSteer ? "steer" : hasQueue ? "queue" : undefined
        let shouldRun = input.force || hasSteer || hasQueue
        const repeatedTracker: { current?: RunnerRepeatedCall.RepeatedToolCall } = {}
        // M8 goal mode: when the model stops (no tool calls) after writing files,
        // the goal may be unfinished — verification reports are in context, so
        // push a bounded number of continuation turns instead of accepting an
        // early finish. Reusing `repeatedTracker` keeps continuation turns under
        // the same repeated-call guard.
        const goalSession = yield* getSession(input.sessionID)
        const goal = RunnerGoal.goalOf(goalSession.metadata)
        const goalValue = goal === undefined ? undefined : Goal.create({ id: input.sessionID, statement: goal })
        let goalContinuations = 0
        while (shouldRun) {
          let needsContinuation = true
          let step = 1
          let slotUpgraded = false
          let continuationCount = 0
          let maxTokensOverride: number | undefined
          const maxContinuations = 3
          // Whether the previous turn wrote files: a stop right after writes is a
          // possible early finish on a goal, so push one bounded continuation.
          let lastTurnWrote = false
          while (needsContinuation) {
            const result = yield* runTurn(input.sessionID, promotion, step, repeatedTracker, maxTokensOverride)
            // Plugin turn lifecycle: notify stop hooks once the turn settles.
            yield* result.turnStop()
        // M9 auto-verify: after a turn with writes, run matching verifiers and
        // publish the reports as a durable synthetic message so the next turn
        // sees verification feedback without being asked to run it.
        yield* autoVerify(input.sessionID, result.writtenPaths)
        // C12 goal drift: out-of-plan writes feed the goal state machine and
        // surface as a next-turn system note so the model can correct course.
        if (goal !== undefined && Option.isSome(goalService)) {
          for (const written of result.writtenPaths) {
            const drift = yield* goalService.value.drift(goalValue!, written)
            if (drift !== null && drift.kind !== "minor") {
              yield* Ref.update(goalDrift, (map) =>
                new Map(map).set(input.sessionID, `${drift.detail}\nSuggested: ${drift.suggested}`),
              )
            }
          }
        }
        needsContinuation = result.needsContinuation
            step = result.step + 1
            promotion = "steer"
            if (!needsContinuation) needsContinuation = yield* SessionInput.hasPending(db, input.sessionID, "steer")
            // M8 goal mode: the model stopped (no tool calls) right after writing
            // files, which may be an early finish. The auto-verify report is in
            // context; give it a bounded number of continuation turns to confirm
            // or keep fixing. Repeating stops without progress end the drain.
            if (!needsContinuation && goal !== undefined && lastTurnWrote && goalContinuations < RunnerGoal.GOAL_MAX_CONTINUATIONS) {
              goalContinuations++
              needsContinuation = true
            }
            lastTurnWrote = result.writtenPaths.length > 0
            // Output was truncated (stop_reason: "length") — apply escalation
            // regardless of tool calls: a turn that both called tools and truncated
            // must still consume the escalation budget, otherwise the drain loops
            // forever on output-limited models with no agent step cap.
            if (!result.truncated) continue
            if (!slotUpgraded) {
              const session = yield* getSession(input.sessionID)
              const resolvedModel = yield* models.resolve(session)
              const modelOutputLimit = resolvedModel.route.defaults?.limits?.output
              if (modelOutputLimit !== undefined) {
                slotUpgraded = true
                maxTokensOverride = modelOutputLimit
                needsContinuation = true
                continue
              }
            }
            if (continuationCount < maxContinuations) {
              continuationCount++
              needsContinuation = true
              continue
            }
            // Level 3: graceful degradation — fail orphaned tool calls and settle the
            // drain; the escalation budget is exhausted and the model cannot produce
            // a complete response within its output limit.
            yield* result.publisher.failOrphanedToolCalls(
              "Tool call was incomplete due to output token limit. Please re-issue the complete tool call.",
            )
            needsContinuation = false
          }
          shouldRun = yield* SessionInput.hasPending(db, input.sessionID, "queue")
          promotion = shouldRun ? "queue" : undefined
        }
        // Run the extra title provider turn on a detached fiber so the drain itself does not stall;
        // the closure-captured services make the effect self-contained.
        Effect.runFork(ensureTitle(input.sessionID).pipe(Effect.catch(() => Effect.void)))
      })
      yield* drain.pipe(Effect.ensuring(Effect.sync(() => Effect.runFork(hooks.runSessionEnd().pipe(Effect.catch(() => Effect.void))))))
    })

    // Derive a title from the first user message once, in bounded background
    // work, so the drain itself does not stall on the extra provider turn.
    const ensureTitle = Effect.fn("SessionRunner.ensureTitle")(function* (sessionID: SessionSchema.ID) {
      const session = yield* getSession(sessionID)
      if (session.parentID !== undefined || !SessionSchema.isDefaultTitle(session.title)) return
      const entries = yield* SessionHistory.entries(db, session.id)
      const userText = entries
        .filter((entry) => entry.message.type === "user")
        .map((entry) => (entry.message as SessionMessage.User).text?.trim())
        .find((text) => text !== undefined && text.length > 0)
      if (userText === undefined) return
      const model = yield* models.resolve(session)
      const request = LLM.request({
        model,
        cache: "none",
        system: [SystemPart.make(RunnerTitle.TITLE_PROMPT)],
        messages: [Message.user(userText)],
        generation: { maxTokens: 40 },
      })
      const chunks: Array<string> = []
      let failed = false
      yield* llm.stream(request).pipe(
        Stream.runForEach((event) => {
          if (LLMEvent.is.providerError(event)) failed = true
          if (LLMEvent.is.textDelta(event)) chunks.push(event.text)
          return Effect.void
        }),
        Effect.catch(() => Effect.void),
      )
      const title = (failed ? "" : chunks.join(""))
        .replace(/ thinking[\s\S]*?<\/think>\s*/g, "")
        .split("\n")
        .map((line) => line.trim())
        .find((line) => line.length > 0)
      if (title === undefined) return
      const bounded = title.length > 100 ? `${title.substring(0, 97)}...` : title
      yield* db
        .update(SessionTable)
        .set({ title: bounded, time_updated: Date.now() })
        .where(eq(SessionTable.id, session.id))
        .run()
        .pipe(Effect.orDie)
    })

    // Failures before a step starts have no assistant message to settle via
    // Step.Failed; the live Failed event keeps every drain failure client-visible.
    const publishRunFailure = Effect.fnUntraced(function* (
      sessionID: SessionSchema.ID,
      cause: Cause.Cause<RunError>,
    ) {
      const failure = Cause.squash(cause)
      yield* events.publish(SessionEvent.Failed, {
        timestamp: yield* DateTime.now,
        sessionID,
        error: {
          type: "unknown",
          message: failure instanceof Error ? failure.message : String(failure),
        },
      })
    })

    const compact = Effect.fn("SessionRunner.compact")(function* (input: {
      readonly sessionID: SessionSchema.ID
      readonly instructions?: string
    }) {
      const session = yield* getSession(input.sessionID)
      const model = yield* models.resolve(session)
      const entries = yield* SessionHistory.entries(db, session.id)
      return yield* compaction.compactManually({
        sessionID: session.id,
        entries,
        model,
        instructions: input.instructions,
      })
    })

    return Service.of({
      run: (input) =>
        run(input).pipe(
          Effect.tapCause((cause) =>
            Cause.hasInterruptsOnly(cause) ? Effect.void : publishRunFailure(input.sessionID, cause),
          ),
        ),
      compact,
    })
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [
    EventV2.node,
    llmClient,
    AgentV2.node,
    ToolRegistry.node,
    ToolGuard.node,
    SessionToolPermissions.node,
    SessionHooks.node,
    SessionRunnerModel.node,
    SessionStore.node,
    Location.node,
    SystemContextRegistry.node,
    SkillGuidance.node,
    SessionTodo.node,
    ReferenceGuidance.node,
    Goal.node,
    Catalog.node,
    Config.node,
    Snapshot.node,
    Global.node,
    Database.node,
  ],
})