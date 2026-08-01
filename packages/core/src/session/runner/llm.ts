import {
  CacheHint,
  LLM,
  LLMClient,
  LLMError,
  LLMEvent,
  Message,
  SystemPart,
  isContextOverflowFailure,
  type ProviderErrorEvent,
} from "@opencode-ai/llm"
import { Cause, DateTime, Effect, FiberSet, Layer, Option, Semaphore, Stream } from "effect"
import { eq } from "drizzle-orm"
import { Catalog } from "../../catalog"
import { AgentV2 } from "../../agent"
import { Config } from "../../config"
import { Database } from "../../database/database"
import { EventV2 } from "../../event"
import { Location } from "../../location"
import { ModelV2 } from "../../model"
import { PermissionV2 } from "../../permission"
import { ProviderV2 } from "../../provider"
import { QuestionV2 } from "../../question"
import { SystemContext } from "../../system-context/index"
import { SystemContextRegistry } from "../../system-context/registry"
import { SkillGuidance } from "../../skill/guidance"
import { ReferenceGuidance } from "../../reference/guidance"
import { SessionHooks } from "../hooks"
import { ToolRegistry } from "../../tool/registry"
import { ToolOutputStore } from "../../tool-output-store"
import { SessionContextEpoch } from "../context-epoch"
import { SessionCompaction } from "../compaction"
import { ContextLevels } from "../context-levels"
import { SessionEvent } from "../event"
import { SessionHistory } from "../history"
import { SessionInput } from "../input"
import { SessionSchema } from "../schema"
import { SessionStore } from "../store"
import { SessionTable } from "../sql"
import { type RunError, Service } from "./index"
import { SessionRunnerModel } from "./model"
import { createLLMEventPublisher } from "./publish-llm-event"
import { toLLMMessages } from "./to-llm-message"
import { MAX_STEPS_PROMPT } from "./max-steps"
import { Snapshot } from "../../snapshot"
import { makeLocationNode } from "../../effect/app-node"
import { llmClient } from "../../effect/app-node-platform"
import type { ToolResultValue } from "@opencode-ai/llm"

const safe = (value: number | undefined) => Math.max(0, Number.isFinite(value) ? (value ?? 0) : 0)

const computeCost = (
  usage: {
    readonly inputTokens: number
    readonly outputTokens: number
    readonly cacheReadInputTokens: number
    readonly cacheWriteInputTokens: number
    readonly reasoningTokens: number
  },
  costTiers: ReadonlyArray<{ readonly tier?: { readonly type: "context"; readonly size: number }; readonly input: number; readonly output: number; readonly cache: { readonly read: number; readonly write: number } }>,
): number => {
  if (costTiers.length === 0) return 0
  const contextTokens = usage.inputTokens
  const tier =
    costTiers
      .filter((item) => item.tier === undefined || (item.tier.type === "context" && contextTokens > item.tier.size))
      .sort((a, b) => (b.tier?.size ?? 0) - (a.tier?.size ?? 0))[0]
  const nonCachedInput = Math.max(0, contextTokens - usage.cacheReadInputTokens - usage.cacheWriteInputTokens)
  const visibleOutput = Math.max(0, usage.outputTokens - usage.reasoningTokens)
  return (
    nonCachedInput * tier.input +
    visibleOutput * tier.output +
    usage.cacheReadInputTokens * tier.cache.read +
    usage.cacheWriteInputTokens * tier.cache.write +
    usage.reasoningTokens * tier.output
  ) / 1_000_000
}

const appendContextNote = (result: ToolResultValue, note: string): ToolResultValue => {
  if (result.type === "error") return result
  if (result.type === "text") return { type: "text", value: String(result.value) + `\n\n<hook-note>\n${note}\n</hook-note>` }
  if (result.type === "content") {
    const notePart = { type: "text" as const, text: `\n<hook-note>\n${note}\n</hook-note>` }
    return { type: "content", value: [...result.value, notePart] }
  }
  return result
}

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
 *   - [ ] Bound provider retries and repeated identical tool calls.
 *
 * - Runtime context assembly
 *   - Track V1 runtime-context parity canonically in `specs/v2/session.md`.
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
 *   - [ ] Settle final status and expose durable output events to replayable consumers.
 *   - [ ] Coalesce streamed deltas and add covering projected-history indexes.
 *   - [ ] Update title, summaries, compaction state, and cleanup in bounded background work.
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
    const tools = yield* ToolRegistry.Service
    const models = yield* SessionRunnerModel.Service
    const store = yield* SessionStore.Service
    const location = yield* Location.Service
    const systemContext = yield* SystemContextRegistry.Service
    const skillGuidance = yield* SkillGuidance.Service
    const referenceGuidance = yield* ReferenceGuidance.Service
    const catalog = yield* Catalog.Service
    const config = yield* Config.Service
    const snapshots = yield* Snapshot.Service
    const db = (yield* Database.Service).db
    const compaction = SessionCompaction.make({ events, llm, config: yield* config.entries() })
    const getSession = Effect.fn("SessionRunner.getSession")(function* (sessionID: SessionSchema.ID) {
      const session = yield* store.get(sessionID)
      if (!session) return yield* Effect.die(`Session not found: ${sessionID}`)
      return session
    })

    // Checks if the agent config specifies a model preference for continuation steps.
    // If so, updates the session's model in the database so the next step picks it up.
    // Note: switching models invalidates the prompt cache, which is acceptable at step boundaries.
    const prepareNextTurn = Effect.fn("SessionRunner.prepareNextTurn")(function* (
      sessionID: SessionSchema.ID,
      agent: AgentV2.Selection,
    ) {
      const continuation = agent.info?.model_preference?.continuation
      if (!continuation) return
      const session = yield* getSession(sessionID)
      if (
        session.model?.providerID === continuation.providerID &&
        session.model.id === continuation.id &&
        (session.model.variant ?? "default") === (continuation.variant ?? "default")
      )
        return
      yield* db
        .update(SessionTable)
        .set({ model: continuation, time_updated: Date.now() })
        .where(eq(SessionTable.id, sessionID))
        .run()
        .pipe(Effect.catch(() => Effect.void))
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

    const awaitToolFibers = (fibers: FiberSet.FiberSet<void, ToolOutputStore.Error>) =>
      Effect.raceFirst(FiberSet.join(fibers), FiberSet.awaitEmpty(fibers))

    // Match V1: declining a user prompt halts the loop instead of becoming model-facing tool output.
    const isUserDeclined = (cause: Cause.Cause<unknown>) =>
      cause.reasons.some(
        (reason) =>
          Cause.isDieReason(reason) &&
          (reason.defect instanceof PermissionV2.DeclinedError || reason.defect instanceof QuestionV2.RejectedError),
      )

    type TurnTransition =
      // Automatic compaction completed; rebuild the request from compacted history.
      | { readonly _tag: "ContinueAfterCompaction"; readonly step: number }
      // Overflow compaction completed; rebuild once through the path without overflow recovery.
      | { readonly _tag: "ContinueAfterOverflowCompaction"; readonly step: number }

    class TurnTransitionError extends Error {
      constructor(readonly transition: TurnTransition) {
        super()
      }
    }

    const continueAfterCompaction = (step: number) => new TurnTransitionError({ _tag: "ContinueAfterCompaction", step })
    const continueAfterOverflowCompaction = (step: number) =>
      new TurnTransitionError({ _tag: "ContinueAfterOverflowCompaction", step })

    const loadSystemContext = (agent: AgentV2.Selection) =>
      Effect.all([systemContext.load(), skillGuidance.load(agent), referenceGuidance.load()], {
        concurrency: "unbounded",
      }).pipe(Effect.map(SystemContext.combine))

    const runTurnAttempt = Effect.fn("SessionRunner.runTurn")(function* (
      sessionID: SessionSchema.ID,
      promotion: SessionInput.Delivery | undefined,
      step: number,
      maxTokensOverride?: number,
      recoverOverflow?: typeof compaction.compactAfterOverflow,
    ) {
      const session = yield* getSession(sessionID)
      if (session.location.directory !== location.directory || session.location.workspaceID !== location.workspaceID)
        return yield* Effect.interrupt
      const agent = yield* agents.select(session.agent)
      const initialized = yield* SessionContextEpoch.initialize(db, loadSystemContext(agent), session.id)
      const toolFibers = yield* FiberSet.make<void, ToolOutputStore.Error>()
      let needsContinuation = false
      let currentStep = step
      if (promotion) {
        const cutoff = yield* EventV2.latestSequence(db, session.id)
        let promoted = 0
        if (promotion === "steer") promoted = yield* SessionInput.promoteSteers(db, events, session.id, cutoff)
        if (promotion === "queue") {
          promoted += Number(yield* SessionInput.promoteNextQueued(db, events, session.id))
          promoted += yield* SessionInput.promoteSteers(db, events, session.id, cutoff)
        }
        if (promoted > 0) currentStep = 1
      }
      const system =
        initialized ?? (yield* SessionContextEpoch.prepare(db, events, loadSystemContext(agent), session.id))
      const model = yield* models.resolve(session)
      const modelInfo = yield* catalog.model.get(ProviderV2.ID.make(model.provider), ModelV2.ID.make(model.id))
      const costTiers = modelInfo?.cost ?? []
      const entries = yield* SessionHistory.entriesForRunner(db, session.id, system.baselineSeq)
      const context = entries.map((entry) => entry.message)
      const isLastStep = agent.info?.steps !== undefined && currentStep >= agent.info.steps
      const toolMaterialization = isLastStep ? undefined : yield* tools.materialize(agent.info?.permissions)
      const promptCacheKey = /^ses_[0-9a-f]{64}$/.test(session.id) ? session.id.slice(4) : session.id
      const rawMessages = [...toLLMMessages(context, model), ...(isLastStep ? [Message.assistant(MAX_STEPS_PROMPT)] : [])]
      const truncatedMessages = ContextLevels.truncateToolOutputs(rawMessages, compaction.settings.levels.l1_max_chars)
      const stableSystem = [agent.info?.system, system.baseline]
        .filter((part): part is string => part !== undefined && part.length > 0)
      const systemParts = stableSystem.map((text, i) => {
        const part = SystemPart.make(text)
        if (i === stableSystem.length - 1) return { ...part, cache: new CacheHint({ type: "persistent", ttlSeconds: 3600 }) }
        return part
      })
      const request = LLM.request({
        model,
        cache: { tools: true, system: true, messages: "latest-user-message", systemTtlSeconds: 3600 },
        providerOptions: { openai: { promptCacheKey } },
        system: systemParts,
        messages: truncatedMessages,
        tools: toolMaterialization?.definitions ?? [],
        toolChoice: isLastStep ? "none" : undefined,
        generation: maxTokensOverride === undefined ? undefined : { maxTokens: maxTokensOverride },
      })

      const degradation = yield* compaction.degrade({ sessionID: session.id, entries, model, request })
      const activeRequest = degradation.request
      if (degradation.compacted)
        return yield* Effect.die(continueAfterCompaction(currentStep))
      const startSnapshot = yield* snapshots.capture()
      const publisher = createLLMEventPublisher(events, {
        sessionID: session.id,
        agent: agent.id,
        model: {
          id: ModelV2.ID.make(model.id),
          providerID: ProviderV2.ID.make(model.provider),
          ...(session.model?.variant === undefined ? {} : { variant: session.model.variant }),
        },
        snapshot: startSnapshot,
      })
      const withPublication = Semaphore.makeUnsafe(1).withPermit
      const publish = (event: LLMEvent, outputPaths: ReadonlyArray<string> = []) =>
        withPublication(publisher.publish(event, outputPaths))
      let overflowFailure: ProviderErrorEvent | undefined
      let didExecuteHostTool = false
      let hasPendingSteer = false
      const collectedPaths: Array<string> = []
      let stepFinishUsage: { readonly inputTokens?: number; readonly outputTokens?: number; readonly cacheReadInputTokens?: number; readonly cacheWriteInputTokens?: number; readonly reasoningTokens?: number } | undefined
      let stepFinishReason: string | undefined
      const providerStream = llm.stream(activeRequest).pipe(
        Stream.runForEach((event) =>
          Effect.gen(function* () {
            if (overflowFailure || publisher.hasProviderError()) return
            if (LLMEvent.is.providerError(event)) {
              if (isContextOverflowFailure(event) && !publisher.hasAssistantStarted()) {
                overflowFailure = event
                return
              }
            }
            if (LLMEvent.is.stepFinish(event)) {
              if (event.usage) stepFinishUsage = event.usage
              stepFinishReason = event.reason
            }
            yield* publish(event)
            // Check for pending steer messages at safe provider-turn boundaries
            if (event.type === "text-end" || event.type === "tool-call") {
              const steerPending = yield* SessionInput.hasPending(db, session.id, "steer")
              if (steerPending && !hasPendingSteer) {
                hasPendingSteer = true
                yield* events.publish(SessionEvent.Steer.Pending, {
                  sessionID: session.id,
                  timestamp: yield* DateTime.now,
                })
              }
            }
            if (event.type !== "tool-call" || event.providerExecuted) return
            didExecuteHostTool = true
            if (!toolMaterialization) {
              yield* withPublication(publisher.failUnsettledTools("Tools are disabled after the maximum agent steps"))
              return
            }
            needsContinuation = true
            const assistantMessageID = yield* publisher.assistantMessageID(event.id)
            yield* Effect.uninterruptibleMask((restore) =>
              Effect.gen(function* () {
                const preResult = yield* hooks.runPreToolUse({ name: event.name, input: event.input })
                if (preResult.action === "deny") {
                  return yield* publish(
                    LLMEvent.toolResult({
                      id: event.id,
                      name: event.name,
                      result: { type: "error", value: `Tool call denied: ${preResult.reason}` },
                    }),
                  )
                }
                if (preResult.action === "skip") {
                  return yield* publish(
                    LLMEvent.toolResult({
                      id: event.id,
                      name: event.name,
                      result: { type: "text", value: "Tool call skipped by hook" },
                    }),
                  )
                }
                const effectiveInput =
                  preResult.action === "allow" && "modifiedInput" in preResult
                    ? preResult.modifiedInput
                    : event.input
                const effectiveCall =
                  effectiveInput === event.input ? event : { ...event, input: effectiveInput }
                const settlement = yield* restore(
                  toolMaterialization.settle({
                    sessionID: session.id,
                    agent: agent.id,
                    assistantMessageID,
                    call: effectiveCall,
                  }),
                )
                if (settlement.outputPaths) {
                  for (const outputPath of settlement.outputPaths) collectedPaths.push(outputPath)
                }
                const postResult = yield* hooks.runPostToolUse({
                  name: event.name,
                  input: effectiveInput,
                  output: settlement.result,
                })
                const resultWithNote =
                  postResult.action === "continue" && "additionalContext" in postResult && postResult.additionalContext
                    ? appendContextNote(settlement.result, postResult.additionalContext)
                    : settlement.result
                return yield* publish(
                  LLMEvent.toolResult({
                    id: event.id,
                    name: event.name,
                    result: resultWithNote,
                    output: settlement.output,
                  }),
                  settlement.outputPaths ?? [],
                )
              }),
            ).pipe(FiberSet.run(toolFibers))
          }),
        ),
        Effect.ensuring(withPublication(publisher.flush())),
      )

      return yield* Effect.uninterruptibleMask((restore) =>
        Effect.gen(function* () {
          const stream = yield* restore(providerStream).pipe(Effect.exit)
          const failure =
            stream._tag === "Failure" ? Option.getOrUndefined(Cause.findErrorOption(stream.cause)) : undefined
          if (
            recoverOverflow &&
            !publisher.hasAssistantStarted() &&
            isContextOverflowFailure(overflowFailure ?? failure) &&
            (yield* restore(recoverOverflow({ sessionID: session.id, entries, model, request: activeRequest })))
          )
            return yield* Effect.die(continueAfterOverflowCompaction(currentStep))
          if (overflowFailure) yield* publish(overflowFailure)
          const llmFailure = failure instanceof LLMError ? failure : undefined
          if (llmFailure && !publisher.hasProviderError()) {
            yield* withPublication(publisher.failUnsettledTools("Provider did not return a tool result", true))
            yield* withPublication(publisher.failAssistant(llmFailure.reason.message))
          }
          if (stream._tag === "Failure" && Cause.hasInterrupts(stream.cause)) yield* FiberSet.clear(toolFibers)
          const settled = yield* restore(awaitToolFibers(toolFibers)).pipe(Effect.exit)
          if (settled._tag === "Failure" && isUserDeclined(settled.cause)) {
            yield* FiberSet.clear(toolFibers)
            yield* withPublication(publisher.failUnsettledTools("Tool execution interrupted"))
            return yield* Effect.interrupt
          }
          if (
            (stream._tag === "Failure" && Cause.hasInterrupts(stream.cause)) ||
            (settled._tag === "Failure" && Cause.hasInterrupts(settled.cause))
          ) {
            yield* FiberSet.clear(toolFibers)
            yield* withPublication(publisher.failUnsettledTools("Tool execution interrupted"))
            if (publisher.hasActiveAssistant())
              yield* withPublication(publisher.failAssistant("Provider turn interrupted"))
          }
          if (settled._tag === "Failure" && !Cause.hasInterrupts(settled.cause)) {
            const failure = Cause.squash(settled.cause)
            const message = failure instanceof Error ? failure.message : String(failure)
            yield* withPublication(publisher.failUnsettledTools(`Tool execution failed: ${message}`))
          }
          if (collectedPaths.length > 0) {
            yield* tools.recordTouchedPaths(collectedPaths)
            yield* tools.activatePaths(collectedPaths)
          }
          const stepSettlement = publisher.stepSettlement()
          if (stepSettlement && !publisher.hasProviderError()) {
            const endSnapshot = didExecuteHostTool ? yield* snapshots.capture() : undefined
            const files =
              startSnapshot && endSnapshot
                ? yield* snapshots
                    .files({ from: startSnapshot, to: endSnapshot })
                    .pipe(Effect.catch(() => Effect.succeed(undefined)))
                : undefined
            yield* withPublication(
              events.publish(SessionEvent.Step.Ended, {
                sessionID: session.id,
                timestamp: yield* DateTime.now,
                assistantMessageID: yield* publisher.startAssistant(),
                finish: stepSettlement.finish,
                cost: stepFinishUsage ? computeCost({ inputTokens: safe(stepFinishUsage.inputTokens), outputTokens: safe(stepFinishUsage.outputTokens), cacheReadInputTokens: safe(stepFinishUsage.cacheReadInputTokens), cacheWriteInputTokens: safe(stepFinishUsage.cacheWriteInputTokens), reasoningTokens: safe(stepFinishUsage.reasoningTokens) }, costTiers) : 0,
                tokens: stepSettlement.tokens,
                snapshot: endSnapshot,
                files,
              }),
            )
          }
          if (publisher.hasProviderError())
            yield* withPublication(publisher.failUnsettledTools("Tool execution interrupted"))
          if (stream._tag === "Success" && !publisher.hasProviderError())
            yield* withPublication(publisher.failUnsettledTools("Provider did not return a tool result", true))
          if (stream._tag === "Failure") return yield* Effect.failCause(stream.cause)
          if (settled._tag === "Failure" && Cause.hasInterrupts(settled.cause))
            return yield* Effect.failCause(settled.cause)
          return {
            needsContinuation: !publisher.hasProviderError() && (needsContinuation || hasPendingSteer),
            step: currentStep,
            truncated: stepFinishReason === "length" && !publisher.hasProviderError(),
            publisher,
          }
        }),
      )
    }, Effect.scoped)
    type RunTurnResult = {
      readonly needsContinuation: boolean
      readonly step: number
      readonly truncated: boolean
      readonly publisher: ReturnType<typeof createLLMEventPublisher>
    }

    type RunTurn = (
      sessionID: SessionSchema.ID,
      promotion: SessionInput.Delivery | undefined,
      step: number,
      maxTokensOverride?: number,
    ) => Effect.Effect<RunTurnResult, RunError>

    const runAfterOverflowCompaction: RunTurn = Effect.fnUntraced(function* (sessionID, promotion, step, maxTokensOverride) {
      return yield* runTurnAttempt(sessionID, promotion, step, maxTokensOverride).pipe(
        Effect.catchDefect(
          Effect.fnUntraced(function* (defect) {
            if (!(defect instanceof TurnTransitionError)) return yield* Effect.die(defect)
            if (defect.transition._tag === "ContinueAfterOverflowCompaction")
              return yield* Effect.die("Post-compaction provider attempt cannot recover another overflow")
            yield* Effect.yieldNow
            return yield* runAfterOverflowCompaction(sessionID, undefined, defect.transition.step, maxTokensOverride)
          }),
        ),
      )
    })

    const runTurn: RunTurn = Effect.fnUntraced(function* (sessionID, promotion, step, maxTokensOverride) {
      return yield* runTurnAttempt(
        sessionID,
        promotion,
        step,
        maxTokensOverride,
        compaction.compactAfterOverflow,
      ).pipe(
        Effect.catchDefect(
          Effect.fnUntraced(function* (defect) {
            if (!(defect instanceof TurnTransitionError)) return yield* Effect.die(defect)
            yield* Effect.yieldNow
            if (defect.transition._tag === "ContinueAfterOverflowCompaction")
              return yield* runAfterOverflowCompaction(sessionID, undefined, defect.transition.step, maxTokensOverride)
            return yield* runTurn(sessionID, undefined, defect.transition.step, maxTokensOverride)
          }),
        ),
      )
    })

    const run = Effect.fn("SessionRunner.run")(function* (input: {
      readonly sessionID: SessionSchema.ID
      readonly force: boolean
    }) {
      const hasSteer = yield* SessionInput.hasPending(db, input.sessionID, "steer")
      const hasQueue = hasSteer ? false : yield* SessionInput.hasPending(db, input.sessionID, "queue")
      if (!input.force && !hasSteer && !hasQueue) return
      yield* failInterruptedTools(input.sessionID)
      let promotion: SessionInput.Delivery | undefined = hasSteer ? "steer" : hasQueue ? "queue" : undefined
      let shouldRun = input.force || hasSteer || hasQueue
      while (shouldRun) {
        let needsContinuation = true
        let step = 1
        let slotUpgraded = false
        let continuationCount = 0
        let maxTokensOverride: number | undefined
        const maxContinuations = 3
        while (needsContinuation) {
          const result = yield* runTurn(input.sessionID, promotion, step, maxTokensOverride)
          needsContinuation = result.needsContinuation
          step = result.step + 1
          promotion = "steer"
          if (!needsContinuation) needsContinuation = yield* SessionInput.hasPending(db, input.sessionID, "steer")
          if (needsContinuation || !result.truncated) continue
          // Output was truncated (stop_reason: "length") — apply escalation
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
          // Level 3: graceful degradation — fail orphaned tool calls
          yield* result.publisher.failOrphanedToolCalls(
            "Tool call was incomplete due to output token limit. Please re-issue the complete tool call.",
          )
        }
        shouldRun = yield* SessionInput.hasPending(db, input.sessionID, "queue")
        promotion = shouldRun ? "queue" : undefined
      }
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
    SessionHooks.node,
    SessionRunnerModel.node,
    SessionStore.node,
    Location.node,
    SystemContextRegistry.node,
    SkillGuidance.node,
    ReferenceGuidance.node,
    Catalog.node,
    Config.node,
    Snapshot.node,
    Database.node,
  ],
})
