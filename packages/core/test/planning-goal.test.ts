import { describe, expect, test } from "bun:test"
import { Cause, Effect, Exit, Layer } from "effect"
import { Observability } from "@opencode-ai/observability"
import { makeObservability } from "@opencode-ai/observability/service"
import { defaultRunContext } from "@opencode-ai/observability/context/index"
import { Goal } from "../src/planning/goal"
import { Planning } from "../src/planning/plan"
import { testEffect } from "./lib/effect"

const node = (id: string, dependsOn: string[] = []) => ({
  id,
  parentID: null,
  title: id,
  goal: "g",
  acceptanceCriteria: [],
  status: "pending" as const,
  dependsOn,
  spent: { tokens: 0, durationMs: 0 },
  checkpoint: false,
})

const it = testEffect(Goal.layer)

const failureMessage = (exit: Exit.Exit<unknown, unknown>): string => {
  if (Exit.isSuccess(exit)) return ""
  return String(Cause.squash(exit.cause))
}

describe("Goal", () => {
  test("create starts pending with empty plan", () => {
    const goal = Goal.create({ id: "g1", statement: "ship it" })
    expect(goal.status).toBe("pending")
    expect(goal.plan.root).toBeNull()
  })

  it.effect("start moves pending → active and stamps startedAt", () =>
    Effect.gen(function* () {
      const service = yield* Goal.Service
      const goal = yield* service.start(Goal.create({ id: "g1", statement: "s" }))
      expect(goal.status).toBe("active")
      expect(goal.startedAt).toBeDefined()
      expect(goal.finishedAt).toBeUndefined()
    }),
  )

  it.effect("complete requires every plan node done", () =>
    Effect.gen(function* () {
      const service = yield* Goal.Service
      const goal = Goal.create({ id: "g1", statement: "s", nodes: [node("a"), node("b", ["a"])] })
      const started = yield* service.start(goal)
      const exit = yield* service.complete(started).pipe(Effect.exit)
      expect(exit._tag).toBe("Failure")
      expect(failureMessage(exit)).toContain("unfinished")
    }),
  )

  it.effect("complete succeeds after all nodes done", () =>
    Effect.gen(function* () {
      const service = yield* Goal.Service
      const plan = Planning.createPlan([node("a")])
      const done = Planning.updateNodeStatus(plan, "a", "done")
      const goal = Goal.create({ id: "g1", statement: "s", nodes: [node("a")] })
      const started = yield* service.start({ ...goal, plan: done })
      const completed = yield* service.complete(started)
      expect(completed.status).toBe("completed")
      expect(completed.finishedAt).toBeDefined()
    }),
  )

  it.effect("cannot complete a never-started goal", () =>
    Effect.gen(function* () {
      const service = yield* Goal.Service
      const goal = Goal.create({ id: "g1", statement: "s", nodes: [node("a")] })
      const exit = yield* service.complete(goal).pipe(Effect.exit)
      expect(exit._tag).toBe("Failure")
    }),
  )

  it.effect("terminal states reject further transitions", () =>
    Effect.gen(function* () {
      const service = yield* Goal.Service
      const failed = yield* service.fail(Goal.create({ id: "g1", statement: "s" }))
      const exit = yield* service.start(failed).pipe(Effect.exit)
      expect(exit._tag).toBe("Failure")
    }),
  )

  it.effect("drift detection returns null in scope, moderate outside", () =>
    Effect.gen(function* () {
      const service = yield* Goal.Service
      const goal = Goal.create({ id: "g1", statement: "s", scopedPaths: ["src/main.ts"] })
      expect(yield* service.drift(goal, "src/main.ts")).toBeNull()
      const drift = yield* service.drift(goal, "src/extra.ts")
      expect(drift?.kind).toBe("moderate")
    }),
  )

  test("observability counters emit on lifecycle", async () => {
    const dir = `/tmp/planning-obs-test-${Date.now()}`
    const obsLayer = Layer.succeed(Observability, makeObservability(dir, defaultRunContext))
    const layer = Layer.merge(Goal.layer, obsLayer)
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* Goal.Service
        const goal = Goal.create({ id: "g1", statement: "s", nodes: [node("a")] })
        yield* service.start(goal)
        const option = yield* Effect.serviceOption(Observability)
        if (option._tag === "None") throw new Error("observability layer missing")
        return option.value.snapshot()
      }).pipe(Effect.provide(layer)),
    )
    expect(result.counters["planning.goal.started{goal=g1,status=active}"]).toBe(1)
    await Bun.$`rm -rf ${dir}`
  })
})
