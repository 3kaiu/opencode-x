// V2 execution — rate-limit-aware swarm scheduler (M4 §4.6).
// Design source: kimi-code AgentSwarm — initial concurrency, throttling phase
// (reorder + backoff doubling + capacity shrink), recovery (+1 capacity after
// a clean window).
export * as Swarm from "./swarm"

import { Effect, Ref } from "effect"

export interface SwarmOptions {
  readonly initialConcurrency?: number    // default 5
  readonly maxConcurrency?: number        // default 8
  readonly backoffBaseMs?: number         // default 3_000; doubles per throttle
  readonly recoveryWindowMs?: number      // default 3 * 60_000 (3 min clean → +1)
}

export interface SwarmState {
  readonly concurrency: number
  readonly throttleCount: number
  readonly lastThrottleAt: number | null
  readonly lastRecoveryAt: number | null
}

export function createSwarmState(options: SwarmOptions = {}): SwarmState {
  return {
    concurrency: options.initialConcurrency ?? 5,
    throttleCount: 0,
    lastThrottleAt: null,
    lastRecoveryAt: null,
  }
}

export function currentBackoffMs(state: SwarmState, options: SwarmOptions = {}): number {
  const base = options.backoffBaseMs ?? 3_000
  return base * 2 ** state.throttleCount
}

/** On throttle: shrink capacity (min 1) and count the backoff escalation. */
export function onThrottle(state: SwarmState, at: number, options: SwarmOptions = {}): SwarmState {
  const max = options.maxConcurrency ?? 8
  return {
    concurrency: Math.max(1, Math.floor(state.concurrency / 2)),
    throttleCount: state.throttleCount + 1,
    lastThrottleAt: at,
    lastRecoveryAt: state.lastRecoveryAt,
  }
}

/** After a clean window without throttles, recover +1 capacity (capped). */
export function maybeRecover(
  state: SwarmState,
  now: number,
  options: SwarmOptions = {},
): SwarmState {
  const max = options.maxConcurrency ?? 8
  const window = options.recoveryWindowMs ?? 3 * 60_000
  if (state.throttleCount === 0) return state
  if (state.lastThrottleAt !== null && now - state.lastThrottleAt < window) return state
  if (state.lastRecoveryAt !== null && now - state.lastRecoveryAt < window) return state
  return {
    concurrency: Math.min(max, state.concurrency + 1),
    throttleCount: Math.max(0, state.throttleCount - 1),
    lastThrottleAt: state.lastThrottleAt,
    lastRecoveryAt: now,
  }
}

export interface SwarmTask<A> {
  readonly id: string
  readonly run: Effect.Effect<A, unknown>
  readonly priority?: number   // higher = reorder earlier on throttle
}

/**
 * Runs tasks with a swarm: tasks execute at the current capacity; on throttle
 * (signaled by `isThrottleError`), capacity shrinks and the swarm waits out the
 * backoff before resuming. Reorders remaining tasks by priority.
 */
export function runSwarm<A>(
  tasks: ReadonlyArray<SwarmTask<A>>,
  options: SwarmOptions = {},
  isThrottleError: (e: unknown) => boolean = (e) =>
    e instanceof Error && /rate.?limit|429|throttle|too many requests/i.test(e.message),
): Effect.Effect<{ readonly results: ReadonlyArray<A>; readonly state: SwarmState }, unknown> {
  return Effect.gen(function* () {
    let state = createSwarmState(options)
    const pending = [...tasks].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))
    const results = new Array<A>(tasks.length)
    let index = 0
    while (pending.length > 0) {
      const batch = pending.splice(0, state.concurrency)
      const settled = yield* Effect.forEach(
        batch,
        (task) =>
          task.run.pipe(
            Effect.tapError((e) =>
              Effect.sync(() => {
                if (isThrottleError(e)) state = onThrottle(state, Date.now(), options)
              }),
            ),
            Effect.catch(() => Effect.succeed(undefined)),
          ),
        { concurrency: state.concurrency },
      )
      for (const value of settled) {
        if (value !== undefined) results[index] = value
        index += 1
      }
      if (state.lastThrottleAt !== null) {
        const backoff = currentBackoffMs(state, options)
        yield* Effect.sleep(backoff)
      }
      state = maybeRecover(state, Date.now(), options)
    }
    return { results, state }
  })
}
