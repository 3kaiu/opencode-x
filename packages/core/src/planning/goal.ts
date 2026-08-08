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

export type GoalStatus = "pending" | "active" | "completed" | "failed" | "abandoned"

export interface Goal {
  readonly id: string
  readonly statement: string
  readonly status: GoalStatus
  readonly createdAt: number
  readonly startedAt?: number
  readonly finishedAt?: number
  readonly plan: PlanStore
  readonly scopedPaths: ReadonlyArray<string>
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
}): Goal => ({
  id: input.id,
  statement: input.statement,
  status: "pending",
  createdAt: Date.now(),
  plan: createPlan(input.nodes ?? []),
  scopedPaths: input.scopedPaths ?? [],
})

const transition = (goal: Goal, to: GoalStatus, label: string): Effect.Effect<Goal, GoalTransitionError> => {
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
  readonly start: (goal: Goal) => Effect.Effect<Goal, GoalTransitionError>
  readonly complete: (goal: Goal) => Effect.Effect<Goal, GoalTransitionError>
  readonly fail: (goal: Goal) => Effect.Effect<Goal, GoalTransitionError>
  readonly abandon: (goal: Goal) => Effect.Effect<Goal, GoalTransitionError>
  readonly drift: (goal: Goal, writtenPath: string) => Effect.Effect<Drift | null>
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

    const start = Effect.fn("Goal.start")(function* (goal: Goal) {
      const updated = yield* transition(goal, "active", "start")
      yield* record("planning.goal.started", "counter", { goal: goal.id, status: updated.status }, 1)
      return updated
    })

    const complete = Effect.fn("Goal.complete")(function* (goal: Goal) {
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

    const fail = Effect.fn("Goal.fail")(function* (goal: Goal) {
      const updated = yield* transition(goal, "failed", "fail")
      yield* record("planning.goal.failed", "counter", { goal: goal.id, status: updated.status }, 1)
      return updated
    })

    const abandon = Effect.fn("Goal.abandon")(function* (goal: Goal) {
      const updated = yield* transition(goal, "abandoned", "abandon")
      yield* record("planning.goal.abandoned", "counter", { goal: goal.id, status: updated.status }, 1)
      return updated
    })

    const drift = Effect.fn("Goal.drift")(function* (goal: Goal, writtenPath: string) {
      const result = detectDrift(writtenPath, goal.plan, goal.scopedPaths)
      if (result) yield* record("planning.goal.drift", "counter", { goal: goal.id }, 1)
      return result
    })

    return { start, complete, fail, abandon, drift }
  }),
)

export const locationLayer = layer

export const node = makeLocationNode({ service: Service, layer, deps: [] })
