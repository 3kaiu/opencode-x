export * as SubagentCoordinator from "./coordinator"

import { Deferred, Effect, Exit, Scope } from "effect"
import type { SessionSchema } from "../session/schema"

/** Tracks active subagent executions and supports interruption */
export interface Coordinator {
  /** Get all active subagent session IDs */
  readonly active: Effect.Effect<ReadonlySet<SessionSchema.ID>>
  /** Register a subagent as active */
  readonly register: (sessionID: SessionSchema.ID) => Effect.Effect<void>
  /** Unregister a subagent when it completes */
  readonly unregister: (sessionID: SessionSchema.ID) => Effect.Effect<void>
  /** Interrupt a running subagent */
  readonly interrupt: (sessionID: SessionSchema.ID) => Effect.Effect<void>
  /** Wait for a subagent to complete */
  readonly awaitCompletion: (sessionID: SessionSchema.ID) => Effect.Effect<void>
}

type Entry = {
  readonly done: Deferred.Deferred<void>
  stopping: boolean
  completed: boolean
}

export const make = (): Effect.Effect<Coordinator, never, Scope.Scope> =>
  Effect.gen(function* () {
    const active = new Map<SessionSchema.ID, Entry>()

    const makeEntry = (): Entry => ({
      done: Deferred.makeUnsafe<void>(),
      stopping: false,
      completed: false,
    })

    const register: Coordinator["register"] = (sessionID) =>
      Effect.sync(() => {
        if (!active.has(sessionID)) {
          active.set(sessionID, makeEntry())
        }
      })

    const unregister: Coordinator["unregister"] = (sessionID) =>
      Effect.sync(() => {
        const entry = active.get(sessionID)
        if (entry && !entry.completed) {
          entry.completed = true
          Deferred.doneUnsafe(entry.done, Exit.succeed(undefined))
          active.delete(sessionID)
        }
      })

    const interrupt: Coordinator["interrupt"] = (sessionID) =>
      Effect.sync(() => {
        const entry = active.get(sessionID)
        if (entry) {
          entry.stopping = true
          // Note: actual interruption would need to be handled by the runner
          // This just marks the session as stopping
        }
      })

    const awaitCompletion: Coordinator["awaitCompletion"] = (sessionID) =>
      Effect.suspend(() => {
        const entry = active.get(sessionID)
        if (!entry) return Effect.void
        return Deferred.await(entry.done)
      })

    const activeEffect: Coordinator["active"] = Effect.sync(() => new Set(active.keys()))

    // Cleanup on scope close
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        for (const entry of active.values()) {
          if (!entry.completed) {
            entry.completed = true
            Deferred.doneUnsafe(entry.done, Exit.succeed(undefined))
          }
        }
        active.clear()
      }),
    )

    return {
      active: activeEffect,
      register,
      unregister,
      interrupt,
      awaitCompletion,
    }
  })
