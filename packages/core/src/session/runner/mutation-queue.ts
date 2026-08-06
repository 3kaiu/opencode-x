// Online mutation serialization for eager tool settlement (M3 §3.6 算法 3).
//
// The session runner settles tools eagerly as the provider stream emits them
// (each tool call runs on its own fiber). Without ordering, two writes to the
// same file race and a bash call can observe a file mid-mutation. This queue
// adds per-file serialization plus an exclusive global gate, without changing
// the eager execution model:
//
//   - `file` writes: same realpath serializes, different paths run in parallel
//   - `exclusive` tools (bash): wait for in-flight writes, and block new ones
//   - `none` (readers): never wait — atomic temp+rename writes make reads safe
//
// Fairness: while an exclusive tool waits, new writes wait too (no starvation).
export * as MutationQueue from "./mutation-queue"

import path from "node:path"
import { Effect, Ref, Semaphore } from "effect"

export type Access =
  | { readonly kind: "file"; readonly path: string }
  | { readonly kind: "exclusive" }
  | { readonly kind: "none" }

interface GateState {
  readonly shared: number
  readonly exclusive: boolean
  readonly waitingExclusive: boolean
}

export interface MutationQueue {
  readonly run: <A, E>(access: Access, effect: Effect.Effect<A, E>) => Effect.Effect<A, E>
}

const makeGate = (state: Ref.Ref<GateState>) => {
  const waitUntil = (predicate: (s: GateState) => boolean) =>
    Effect.gen(function* () {
      while (true) {
        if (predicate(yield* Ref.get(state))) return
        yield* Effect.sleep(1)
      }
    })
  // NOTE: `Effect.acquireRelease` in Effect 4.0.0-beta.83 registers the
  // release as a scope finalizer, so it only runs when the enclosing scope
  // closes. `Effect.ensuring` keeps the release bound to the effect itself,
  // which is the acquire/release timing a lock needs.
  const shared = <A, E>(effect: Effect.Effect<A, E>): Effect.Effect<A, E> =>
    waitUntil((s) => !s.exclusive && !s.waitingExclusive).pipe(
      Effect.andThen(Ref.update(state, (s) => ({ ...s, shared: s.shared + 1 }))),
      Effect.andThen(() => Effect.ensuring(effect, Ref.update(state, (s) => ({ ...s, shared: s.shared - 1 })))),
    )
  const exclusive = <A, E>(effect: Effect.Effect<A, E>): Effect.Effect<A, E> =>
    Ref.update(state, (s) => ({ ...s, waitingExclusive: true })).pipe(
      Effect.andThen(waitUntil((s) => s.shared === 0)),
      Effect.andThen(Ref.update(state, (s) => ({ ...s, exclusive: true, waitingExclusive: false }))),
      Effect.andThen(() => Effect.ensuring(effect, Ref.update(state, (s) => ({ ...s, exclusive: false })))),
    )
  return { shared, exclusive }
}

export const make = Effect.gen(function* () {
  const state = yield* Ref.make<GateState>({ shared: 0, exclusive: false, waitingExclusive: false })
  const gate = makeGate(state)
  const perFile = new Map<string, Semaphore.Semaphore>()
  const run: MutationQueue["run"] = (access, effect) => {
    if (access.kind === "exclusive") return gate.exclusive(effect)
    if (access.kind === "none") return effect
    let semaphore = perFile.get(access.path)
    if (!semaphore) {
      semaphore = Semaphore.makeUnsafe(1)
      perFile.set(access.path, semaphore)
    }
    return semaphore.withPermit(gate.shared(effect))
  }
  return { run }
})

const WRITE_TOOLS = new Set(["edit", "write", "apply_patch"])
const EXCLUSIVE_TOOLS = new Set(["bash"])

/**
 * Call-level access derivation: write tools serialize per target file, bash
 * takes the exclusive gate, everything else (readers, session-internal tools)
 * is unlocked. `baseDir` resolves relative paths the way tools do.
 */
export function accessOfCall(call: { readonly name: string; readonly input: unknown }, baseDir: string): Access {
  if (EXCLUSIVE_TOOLS.has(call.name)) return { kind: "exclusive" }
  if (WRITE_TOOLS.has(call.name)) {
    const input = call.input as { path?: unknown }
    if (typeof input?.path === "string") {
      const target = path.isAbsolute(input.path) ? input.path : path.resolve(baseDir, input.path)
      return { kind: "file", path: target }
    }
  }
  return { kind: "none" }
}
