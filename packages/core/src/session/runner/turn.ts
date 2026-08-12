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
  type ToolResultValue,
  type LLMClientShape,
} from "@opencode-ai/llm"
import { Cause, DateTime, Effect, FiberSet, Option, Ref, Semaphore, Stream } from "effect"
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
import { MutationQueue } from "./mutation-queue"
import { RunnerCost } from "./cost"
import { RunnerGoal } from "./goal"
import { RunnerRepeatedCall } from "./repeated-call"
import { RunnerSediment } from "./sediment"
import { SessionRunnerModel } from "./model"
import { Isolation } from "../../security/isolation"
import { Trigger } from "../../verify/trigger"
import { Verify } from "../../verify/verifier"
import { Memory } from "../../memory/store"
import { Snapshot } from "../../snapshot"
import { Goal } from "../../planning/goal"
import type { MessageDecodeError } from "../error"
import { createLLMEventPublisher } from "./publish-llm-event"
import { toLLMMessages } from "./to-llm-message"
import { MAX_STEPS_PROMPT } from "./max-steps"
import { retrieveMemoryLayer } from "./memory"
import type { RunError } from "./index"

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

export interface TurnDependencies {
  readonly events: EventV2.Interface
  readonly llm: LLMClientShape
  readonly agents: AgentV2.Interface
  readonly hooks: SessionHooks.Interface
  readonly tools: ToolRegistry.Interface
  readonly sessionToolPermissions: SessionToolPermissions.Interface
  readonly models: SessionRunnerModel.Interface
  readonly store: SessionStore.Interface
  readonly location: Location.Interface
  readonly goalService: Option.Option<Goal.Interface>
  readonly goalDrift: Ref.Ref<Map<string, string>>
  readonly systemContext: SystemContextRegistry.Interface
  readonly skillGuidance: SkillGuidance.Interface
  readonly referenceGuidance: ReferenceGuidance.Interface
  readonly catalog: Catalog.Interface
  readonly config: Config.Interface
  readonly snapshots: Snapshot.Interface
  readonly db: Database.Interface["db"]
  readonly pendingSteers: Ref.Ref<ReadonlySet<string>>
  readonly compaction: ReturnType<typeof SessionCompaction.make>
  readonly v2Memory: Effect.Effect<Effect.Effect<Memory.MemoryStore>>
  readonly getSession: (sessionID: SessionSchema.ID) => Effect.Effect<SessionSchema.Info>
  readonly getContext: (sessionID: SessionSchema.ID) => Effect.Effect<SessionMessage.Message[], MessageDecodeError>
}

export const makeTurnRunner = (deps: TurnDependencies) => {
  const { events, llm, agents, hooks, tools, sessionToolPermissions, models, store, location } = deps
  const { goalService, goalDrift, systemContext, skillGuidance, referenceGuidance, catalog, config, snapshots, db } = deps
  const { pendingSteers, compaction, v2Memory, getSession, getContext } = deps

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
    const memoryLayer = yield* retrieveMemoryLayer(
      yield* (yield* v2Memory),
      lastUserText ?? "",
      model.route.defaults.limits?.context,
    )
    const stableSystem = [
      agent.info?.system,
      system.baseline,
      turnFeedback ? `Plugin guidance for this turn:\n${turnFeedback}` : undefined,
      memoryLayer,
      // M8 goal mode: a session-level task statement keeps long-running work
      // on track. Injected every turn so the model never loses the objective.
      RunnerGoal.goalOf(session.metadata)
        ? RunnerGoal.goalSystemText(RunnerGoal.goalOf(session.metadata)!)
        : undefined,
      // C12 goal drift: out-of-plan writes detected after a previous turn are
      // surfaced here so the model can acknowledge or correct course.
      (yield* Ref.get(goalDrift)).get(session.id),
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

  return { runTurn, autoVerify }
}
