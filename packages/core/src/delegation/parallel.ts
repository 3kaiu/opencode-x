// V2 execution — parallel group (M4 §4.6).
// fan-out with conflict pre-check, bounded concurrency, stable source-order
// fan-in. Design source: kimi-code AgentSwarm + pi worker pool.
export * as Parallel from "./parallel"

import { Effect, Semaphore } from "effect"

export interface Task<A> {
  readonly id: string
  readonly run: Effect.Effect<A, unknown>
  /** Paths this task writes (conflict pre-check input). */
  readonly writes?: ReadonlyArray<string>
}

export interface ParallelOptions {
  readonly concurrency?: number   // default 5
  readonly maxTasks?: number      // default 8 per group
}

export interface ParallelResult<A> {
  readonly results: ReadonlyArray<A>   // source order
}

const DEFAULT_OPTS: Required<ParallelOptions> = {
  concurrency: 5,
  maxTasks: 8,
}

/** Conflict pre-check: two tasks writing overlapping paths must not fan out. */
export function detectWriteConflict(tasks: ReadonlyArray<Task<unknown>>): ReadonlyArray<[string, string]> {
  const pairs: Array<[string, string]> = []
  for (let i = 0; i < tasks.length; i++) {
    for (let j = i + 1; j < tasks.length; j++) {
      const a = tasks[i].writes ?? []
      const b = tasks[j].writes ?? []
      if (a.some((pa) => b.some((pb) => pa === pb || pa.startsWith(`${pb}/`) || pb.startsWith(`${pa}/`)))) {
        pairs.push([tasks[i].id, tasks[j].id])
      }
    }
  }
  return pairs
}

/**
 * Runs tasks with bounded concurrency. Results are returned in source order.
 * Fails fast on write conflicts (caller should serialize conflicting tasks).
 */
export function runGroup<A>(tasks: ReadonlyArray<Task<A>>, options: ParallelOptions = {}): Effect.Effect<
  ParallelResult<A>,
  unknown
> {
  return Effect.gen(function* () {
    if (tasks.length === 0) return { results: [] as ReadonlyArray<A> }
    const opts = { ...DEFAULT_OPTS, ...options }
    if (tasks.length > opts.maxTasks) {
      yield* Effect.fail(new Error(`parallel group exceeds maxTasks (${opts.maxTasks})`))
    }
    const conflicts = detectWriteConflict(tasks as ReadonlyArray<Task<unknown>>)
    if (conflicts.length > 0) {
      yield* Effect.fail(
        new Error(`parallel write conflict detected: ${conflicts.map(([a, b]) => `${a}~${b}`).join(", ")}`),
      )
    }
    const semaphore = Semaphore.makeUnsafe(opts.concurrency)
    const settled = yield* Effect.forEach(tasks, (task) => semaphore.withPermit(task.run), {
      concurrency: opts.concurrency,
    })
    return { results: settled }
  })
}
