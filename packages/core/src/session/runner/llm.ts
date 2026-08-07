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
import { Cause, DateTime, Effect, FiberSet, Layer, Option, Ref, Semaphore, Stream } from "effect"
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
import { SessionToolPermissions } from "../tool-permissions"
import { ToolRegistry } from "../../tool/registry"
import { ToolOutputStore } from "../../tool-output-store"
import { SessionContextEpoch } from "../context-epoch"
import { SessionCompaction } from "../compaction"
import { ContextLevels } from "../context-levels"
import { SessionEvent } from "../event"
import { SessionHistory } from "../history"
import { SessionInput } from "../input"
import { SessionMessage } from "../message"
import { SessionSchema } from "../schema"
import { SessionStore } from "../store"
import { SessionTable } from "../sql"
import { type RunError, Service } from "./index"
import { MutationQueue } from "./mutation-queue"
import { RunnerCost } from "./cost"
import { RunnerGoal } from "./goal"
import { RunnerRepeatedCall } from "./repeated-call"
import { RunnerSediment } from "./sediment"
import { RunnerTitle } from "./title"
import { SessionRunnerModel } from "./model"
import { Isolation } from "../../security/isolation"
import { Trigger } from "../../verify/trigger"
import { Verify } from "../../verify/verifier"
import { Sediment } from "../../memory/sediment"
import { Memory } from "../../memory/store"
import { Global } from "../../global"
import { createHash } from "node:crypto"
import path from "node:path"
import { createLLMEventPublisher } from "./publish-llm-event"
import { toLLMMessages } from "./to-llm-message"
import { MAX_STEPS_PROMPT } from "./max-steps"
import { Snapshot } from "../../snapshot"
import { makeLocationNode } from "../../effect/app-node"
import { llmClient } from "../../effect/app-node-platform"
import type { ToolResultValue } from "@opencode-ai/llm"

// Canonicalizes tool arguments so JSON key order does not defeat the comparison.
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
    const tools = yield* ToolRegistry.Service
    const sessionToolPermissions = yield* SessionToolPermissions.Service
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
    const compaction = SessionCompaction.make({ events, llm, config: yield* config.entries() })
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

      const awaitToolFibers = (fibers: FiberSet.FiberSet<void, ToolOutputStore.Error>) =>
      // Wait for every started tool fiber to settle first, so each publishes its own
      // outcome normally and no in-flight sibling is marked settled prematurely. Then
      // surface any recorded failure: after awaitEmpty, FiberSet.join resolves
      // immediately with the first failure (its deferred completes on a fiber failure),
      // or never completes when all tools succeeded, so racing it against void yields
      // exactly the failure when one occurred. The previous raceFirst(join, awaitEmpty)
      // could swallow a tool failure when awaitEmpty won the tie, or mark in-flight
      // siblings settled whose later publish hit a "Duplicate tool result" die.
      FiberSet.awaitEmpty(fibers).pipe(
        Effect.andThen(Effect.raceFirst(FiberSet.join(fibers), Effect.void)),
      )

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
      repeatedTracker: { current?: RunnerRepeatedCall.RepeatedToolCall },
      maxTokensOverride?: number,
      recoverOverflow?: typeof compaction.compactAfterOverflow,
    ) {
      const session = yield* getSession(sessionID)
      if (session.location.directory !== location.directory || session.location.workspaceID !== location.workspaceID)
        return yield* Effect.interrupt
      const agent = yield* agents.select(session.agent)
      const initialized = yield* SessionContextEpoch.initialize(db, loadSystemContext(agent), session.id)
      const toolFibers = yield* FiberSet.make<void, ToolOutputStore.Error>()
      // Online mutation serialization: same-file writes serialize, bash waits
      // for in-flight writes (M3 per-file queue as eager-settlement ordering).
      const mutationQueue = yield* MutationQueue.make
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
      // Plugin turn lifecycle (Claude Code UserPromptSubmit): blocking feedback
      // is injected into the system layer before the provider request.
      const lastUserText = [...context]
        .reverse()
        .find((message) => message.type === "user")
        ?.text
      const turnStart = yield* hooks
        .runTurnStart({ prompt: lastUserText ?? "" })
        .pipe(Effect.catch(() => Effect.succeed({ action: "continue" as const })))
      const turnFeedback =
        turnStart && "feedback" in turnStart && turnStart.feedback ? turnStart.feedback : undefined
      const isLastStep = agent.info?.steps !== undefined && currentStep >= agent.info.steps
      const sessionPermissions = yield* sessionToolPermissions.get(session.id)
      const toolMaterialization = isLastStep
        ? undefined
        : yield* tools.materialize(sessionPermissions ?? agent.info?.permissions)
      const promptCacheKey = /^ses_[0-9a-f]{64}$/.test(session.id) ? session.id.slice(4) : session.id
      const rawMessages = [...toLLMMessages(context, model), ...(isLastStep ? [Message.assistant(MAX_STEPS_PROMPT)] : [])]
      const truncatedMessages = ContextLevels.truncateToolOutputs(rawMessages, compaction.settings.levels.l1_max_chars)
      const stableSystem = [
        agent.info?.system,
        system.baseline,
        turnFeedback ? `Plugin guidance for this turn:\n${turnFeedback}` : undefined,
        // M8 goal mode: a session-level task statement keeps long-running work
        // on track. Injected every turn so the model never loses the objective.
        RunnerGoal.goalOf(session.metadata)
          ? RunnerGoal.goalSystemText(RunnerGoal.goalOf(session.metadata)!)
          : undefined,
      ].filter((part): part is string => part !== undefined && part.length > 0)
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
      // Files this turn's write tools actually modified; used to auto-trigger
      // M9 verifiers at the step boundary (autoVerify).
      const writtenPaths: Array<string> = []
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
            // Check for pending steer messages at safe provider-turn boundaries.
            // Steers admitted on this process hit the in-memory signal; durable
            // `hasPending` at drain/turn boundaries covers anything missed.
            if (event.type === "text-end" || event.type === "tool-call") {
              const steerAdmitted = yield* Ref.get(pendingSteers)
              if (steerAdmitted.has(session.id) && !hasPendingSteer) {
                hasPendingSteer = true
                yield* Ref.update(pendingSteers, (current) => {
                  if (!current.has(session.id)) return current
                  const next = new Set(current)
                  next.delete(session.id)
                  return next
                })
                yield* events.publish(SessionEvent.Steer.Pending, {
                  sessionID: session.id,
                  timestamp: yield* DateTime.now,
                })
              }
            }
            if (event.type !== "tool-call" || event.providerExecuted) return
            const repeated = RunnerRepeatedCall.boundRepeatedToolCalls(repeatedTracker, event)
            if (repeated !== undefined) {
              needsContinuation = true
              return yield* publish(
                LLMEvent.toolResult({
                  id: event.id,
                  name: event.name,
                  result: { type: "error", value: repeated },
                }),
              )
            }
            // The session may have moved mid-turn; refuse to execute tools at a
            // stale location so side effects cannot land in the wrong directory.
            const current = yield* getSession(session.id)
            if (current.location.directory !== location.directory || current.location.workspaceID !== location.workspaceID) {
              needsContinuation = true
              return yield* publish(
                LLMEvent.toolResult({
                  id: event.id,
                  name: event.name,
                  result: { type: "error", value: "Session location changed; tool execution interrupted." },
                }),
              )
            }
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
                // Advertise the running tool so the message-updater's progress consumer has a
                // producer to render live state from; settlement replaces it with the outcome.
                yield* events.publish(SessionEvent.Tool.Progress, {
                  sessionID: session.id,
                  timestamp: yield* DateTime.now,
                  assistantMessageID,
                  callID: event.id,
                  structured: { status: "running" },
                  content: [],
                })
                const settlement = yield* restore(
                  mutationQueue.run(
                    MutationQueue.accessOfCall(effectiveCall, session.location.directory),
                    toolMaterialization.settle({
                      sessionID: session.id,
                      agent: agent.id,
                      assistantMessageID,
                      call: effectiveCall,
                    }),
                  ),
                )
                if (MutationQueue.accessOfCall(effectiveCall, session.location.directory).kind === "file") {
                  const target = (effectiveCall.input as { path?: unknown }).path
                  if (typeof target === "string") writtenPaths.push(target)
                }
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
                // M11: tool output is data — injection heuristics get a marker
                // prefix so the model never mistakes embedded instructions for
                // its own system prompt.
                const resultWithIsolation = Isolation.annotateToolResult(resultWithNote)
                return yield* publish(
                  LLMEvent.toolResult({
                    id: event.id,
                    name: event.name,
                    result: resultWithIsolation,
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
                cost: stepFinishUsage ? RunnerCost.computeCost({ inputTokens: RunnerCost.safe(stepFinishUsage.inputTokens), outputTokens: RunnerCost.safe(stepFinishUsage.outputTokens), cacheReadInputTokens: RunnerCost.safe(stepFinishUsage.cacheReadInputTokens), cacheWriteInputTokens: RunnerCost.safe(stepFinishUsage.cacheWriteInputTokens), reasoningTokens: RunnerCost.safe(stepFinishUsage.reasoningTokens) }, costTiers) : 0,
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
            writtenPaths,
            turnStop: () =>
              hooks
                .runTurnStop({ prompt: lastUserText ?? "", stopReason: stepFinishReason ?? "end" })
                .pipe(Effect.ignore),
          }
        }),
      )
    }, Effect.scoped)
    type RunTurnResult = {
      readonly needsContinuation: boolean
      readonly step: number
      readonly truncated: boolean
      readonly publisher: ReturnType<typeof createLLMEventPublisher>
      readonly writtenPaths: ReadonlyArray<string>
      readonly turnStop: () => Effect.Effect<void>
    }

    type RunTurn = (
      sessionID: SessionSchema.ID,
      promotion: SessionInput.Delivery | undefined,
      step: number,
      repeatedTracker: { current?: RunnerRepeatedCall.RepeatedToolCall },
      maxTokensOverride?: number,
    ) => Effect.Effect<RunTurnResult, RunError>

    const runAfterOverflowCompaction: RunTurn = Effect.fnUntraced(function* (
      sessionID,
      promotion,
      step,
      repeatedTracker,
      maxTokensOverride,
    ) {
      return yield* runTurnAttempt(sessionID, promotion, step, repeatedTracker, maxTokensOverride).pipe(
        Effect.catchDefect(
          Effect.fnUntraced(function* (defect) {
            if (!(defect instanceof TurnTransitionError)) return yield* Effect.die(defect)
            if (defect.transition._tag === "ContinueAfterOverflowCompaction")
              return yield* Effect.die("Post-compaction provider attempt cannot recover another overflow")
            yield* Effect.yieldNow
            return yield* runAfterOverflowCompaction(
              sessionID,
              undefined,
              defect.transition.step,
              repeatedTracker,
              maxTokensOverride,
            )
          }),
        ),
      )
    })

    const runTurn: RunTurn = Effect.fnUntraced(function* (sessionID, promotion, step, repeatedTracker, maxTokensOverride) {
      return yield* runTurnAttempt(
        sessionID,
        promotion,
        step,
        repeatedTracker,
        maxTokensOverride,
        compaction.compactAfterOverflow,
      ).pipe(
        Effect.catchDefect(
          Effect.fnUntraced(function* (defect) {
            if (!(defect instanceof TurnTransitionError)) return yield* Effect.die(defect)
            yield* Effect.yieldNow
            if (defect.transition._tag === "ContinueAfterOverflowCompaction")
              return yield* runAfterOverflowCompaction(
                sessionID,
                undefined,
                defect.transition.step,
                repeatedTracker,
                maxTokensOverride,
              )
            return yield* runTurn(sessionID, undefined, defect.transition.step, repeatedTracker, maxTokensOverride)
          }),
        ),
      )
    })

    // M9 auto-verify: run verifiers matching this turn's written paths and
    // publish rendered reports as a durable synthetic message. Failures drive
    // the next provider turn; passes cost one line of context.
    const autoVerify = Effect.fnUntraced(function* (
      sessionID: SessionSchema.ID,
      writtenPaths: ReadonlyArray<string>,
    ) {
      if (writtenPaths.length === 0) return
      const session = yield* getSession(sessionID)
      const verifiers = Trigger.matchingVerifiers(Verify.DEFAULT_VERIFIERS, writtenPaths)
      if (verifiers.length === 0) return
      const reports = yield* Trigger.runVerifiers(session.location.directory, verifiers)
      const lines = Trigger.renderReports(reports)
      if (lines.length === 0) return
      yield* events.publish(SessionEvent.Synthetic, {
        sessionID,
        messageID: SessionMessage.ID.create(),
        timestamp: yield* DateTime.now,
        text: `[auto-verify] ${lines.join("; ")}`,
      })
      // M5 sediment: failed verifications become pending lessons in the V2
      // memory wire, so future sessions start with the "verify after every
      // write" kind of hindsight. Deduplicated by title in recordPending.
      const store = yield* (yield* v2Memory)
      const locale = Config.latest(yield* config.entries(), "locale")
      yield* Effect.promise(() => RunnerSediment.sedimentVerificationFailures(store, reports, sessionID, locale)).pipe(Effect.ignore)
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
        .replace(/<think>[\s\S]*?<\/think>\s*/g, "")
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
    SessionToolPermissions.node,
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
    Global.node,
    Database.node,
  ],
})
