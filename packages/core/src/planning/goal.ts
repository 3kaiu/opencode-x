// V2 planning — goal state machine (M8 §8.6, P3.2).
// Tracks a session-level task statement through a lifecycle: pending → active →
// completed | failed | abandoned. Reuses the plan tree from `plan.ts` as the
// runtime skeleton and wires drift detection into the machine.
export * as Goal from "./goal"

import { Context, Effect, Layer, Schema } from "effect"
import * as Option from "effect/Option"
import { Observability } from "@opencode-ai/observability"
import { makeLocationNode } from "../effect/app-node"
import { createPlan, detectDrift, isComplete, type Drift, type PlanStore } from "./plan"

import { Planning } from "@opencode-ai/schema/planning"

const COMPLEX_VERBS = [
  "refactor", "重构", "implement", "实现", "migrate", "迁移", "integrate", "集成",
  "redesign", "重新设计", "benchmark", "perf", "performance", "优化", "optimize",
  "rewrite", "重写", "feature", "pipeline", "流水线", "workflow", "架构", "architecture",
]

const STEP_MARKERS = [
  "1.", "2.", "首先", "然后", "第一步", "第二步", "并且", "同时", "after that",
  "step 1", "step 2", "finally", "最后", "接着", "另外", "还需要",
]

const FILE_PATTERN = /(\b[\w-]+\.(?:ts|tsx|js|jsx|json|py|rs|go|md|sql|ya?ml)\b)/gi

export function evaluateComplexity(promptText: string): Planning.AutoGoalDecision {
  if (!promptText || promptText.trim().length === 0) {
    return {
      shouldActivateGoal: false,
      confidence: 0,
      reasoning: "Empty prompt",
    }
  }

  const text = promptText.toLowerCase()
  let score = 0
  const reasons: string[] = []

  if (promptText.length > 200) {
    score += 0.3
    reasons.push("prompt length > 200 chars")
  } else if (promptText.length > 80) {
    score += 0.15
    reasons.push("prompt length > 80 chars")
  }

  const verbMatches = COMPLEX_VERBS.filter((v) => text.includes(v))
  if (verbMatches.length >= 2) {
    score += 0.35
    reasons.push(`multiple action verbs: ${verbMatches.join(", ")}`)
  } else if (verbMatches.length === 1) {
    score += 0.2
    reasons.push(`action verb: ${verbMatches[0]}`)
  }

  const stepMatches = STEP_MARKERS.filter((m) => text.includes(m))
  if (stepMatches.length >= 2) {
    score += 0.3
    reasons.push("multi-step sequencing detected")
  } else if (stepMatches.length === 1) {
    score += 0.15
    reasons.push("step marker detected")
  }

  const fileMatches = promptText.match(FILE_PATTERN)
  if (fileMatches && new Set(fileMatches).size >= 2) {
    score += 0.25
    reasons.push(`references multiple files (${new Set(fileMatches).size} files)`)
  }

  const confidence = Math.min(1.0, Math.max(0.0, Number(score.toFixed(2))))
  const shouldActivateGoal = confidence >= 0.5

  return {
    shouldActivateGoal,
    confidence,
    reasoning: reasons.length > 0 ? reasons.join("; ") : "simple direct query",
  }
}

export class GoalTransitionError extends Schema.TaggedErrorClass<GoalTransitionError>()(
  "Goal.TransitionError",
  {
    id: Schema.String,
    from: Schema.String,
    to: Schema.String,
    message: Schema.String,
  },
) {}

export const create = (input: {
  readonly id: string
  readonly statement: string
  readonly nodes?: Parameters<typeof createPlan>[0]
  readonly scopedPaths?: ReadonlyArray<string>
}): Planning.Goal => ({
  id: input.id,
  statement: input.statement,
  status: "pending",
  createdAt: Date.now(),
  plan: createPlan(input.nodes ?? []),
  scopedPaths: input.scopedPaths ?? [],
})

const transition = (goal: Planning.Goal, to: Planning.GoalStatus, label: string): Effect.Effect<Planning.Goal, GoalTransitionError> => {
  if (goal.status !== "pending" && goal.status !== "active")
    return Effect.fail(
      new GoalTransitionError({
        id: goal.id,
        from: goal.status,
        to,
        message: `Cannot ${label} a goal in ${goal.status} state`,
      }),
    )
  if (goal.status === "pending" && to === "completed")
    return Effect.fail(
      new GoalTransitionError({
        id: goal.id,
        from: goal.status,
        to,
        message: "Cannot complete a goal that was never started",
      }),
    )
  const now = Date.now()
  return Effect.succeed({
    ...goal,
    status: to,
    startedAt: goal.startedAt ?? (to === "active" ? now : undefined),
    finishedAt: to === "active" ? undefined : now,
  })
}

export interface Interface {
  readonly start: (goal: Planning.Goal) => Effect.Effect<Planning.Goal, GoalTransitionError>
  readonly complete: (goal: Planning.Goal) => Effect.Effect<Planning.Goal, GoalTransitionError>
  readonly fail: (goal: Planning.Goal) => Effect.Effect<Planning.Goal, GoalTransitionError>
  readonly abandon: (goal: Planning.Goal) => Effect.Effect<Planning.Goal, GoalTransitionError>
  readonly drift: (goal: Planning.Goal, writtenPath: string) => Effect.Effect<Drift | null>
  readonly evaluateComplexity: (promptText: string) => Effect.Effect<Planning.AutoGoalDecision>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Planning/Goal") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const record = (name: string, kind: "counter" | "timer", labels: Record<string, string>, value: number) =>
      Effect.gen(function* () {
        const observability = Option.getOrUndefined(yield* Effect.serviceOption(Observability))
        observability?.record(kind, name, labels, value)
      })

    const start = Effect.fn("Goal.start")(function* (goal: Planning.Goal) {
      const updated = yield* transition(goal, "active", "start")
      yield* record("planning.goal.started", "counter", { goal: goal.id, status: updated.status }, 1)
      return updated
    })

    const complete = Effect.fn("Goal.complete")(function* (goal: Planning.Goal) {
      if (!isComplete(goal.plan))
        return yield* new GoalTransitionError({
          id: goal.id,
          from: goal.status,
          to: "completed",
          message: "Cannot complete a goal with unfinished plan nodes",
        })
      const updated = yield* transition(goal, "completed", "complete")
      const duration =
        updated.finishedAt !== undefined && updated.startedAt !== undefined
          ? updated.finishedAt - updated.startedAt
          : 0
      yield* record("planning.goal.completed", "counter", { goal: goal.id, status: updated.status }, 1)
      yield* record("planning.goal.duration", "timer", { goal: goal.id }, duration)
      return updated
    })

    const fail = Effect.fn("Goal.fail")(function* (goal: Planning.Goal) {
      const updated = yield* transition(goal, "failed", "fail")
      yield* record("planning.goal.failed", "counter", { goal: goal.id, status: updated.status }, 1)
      return updated
    })

    const abandon = Effect.fn("Goal.abandon")(function* (goal: Planning.Goal) {
      const updated = yield* transition(goal, "abandoned", "abandon")
      yield* record("planning.goal.abandoned", "counter", { goal: goal.id, status: updated.status }, 1)
      return updated
    })

    const drift = Effect.fn("Goal.drift")(function* (goal: Planning.Goal, writtenPath: string) {
      const result = detectDrift(writtenPath, goal.plan, goal.scopedPaths)
      if (result) yield* record("planning.goal.drift", "counter", { goal: goal.id }, 1)
      return result
    })

    const evaluate = Effect.fn("Goal.evaluateComplexity")(function* (promptText: string) {
      const decision = evaluateComplexity(promptText)
      yield* record(
        "planning.goal.auto_decision",
        "counter",
        { activated: decision.shouldActivateGoal ? "true" : "false" },
        1,
      )
      return decision
    })

    return { start, complete, fail, abandon, drift, evaluateComplexity: evaluate }
  }),
)

export const locationLayer = layer

export const node = makeLocationNode({ service: Service, layer, deps: [] })
