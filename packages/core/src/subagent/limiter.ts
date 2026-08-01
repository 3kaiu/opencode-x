export * as SubagentLimiter from "./limiter"

import { Effect, Ref } from "effect"

const MAX_CONCURRENT = 20
const MAX_PER_SESSION = 50

const globalCount = { value: 0 }
const sessionCounts = new Map<string, number>()

export const tryAcquire = (parentSessionID: string): boolean => {
  if (globalCount.value >= MAX_CONCURRENT) return false
  const current = sessionCounts.get(parentSessionID) ?? 0
  if (current >= MAX_PER_SESSION) return false
  globalCount.value++
  sessionCounts.set(parentSessionID, current + 1)
  return true
}

export const release = (parentSessionID: string): void => {
  globalCount.value = Math.max(0, globalCount.value - 1)
  const current = sessionCounts.get(parentSessionID) ?? 0
  if (current <= 1) sessionCounts.delete(parentSessionID)
  else sessionCounts.set(parentSessionID, current - 1)
}

export const withLimit = <A, E, R>(
  parentSessionID: string,
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> =>
  Effect.suspend(() => {
    if (!tryAcquire(parentSessionID)) {
      return Effect.die(
        new Error(
          globalCount.value >= MAX_CONCURRENT
            ? `Concurrent subagent limit reached (${globalCount.value}/${MAX_CONCURRENT})`
            : `Per-session subagent limit reached (${sessionCounts.get(parentSessionID) ?? 0}/${MAX_PER_SESSION})`,
        ),
      )
    }
    return effect.pipe(Effect.ensuring(Effect.sync(() => release(parentSessionID))))
  })
