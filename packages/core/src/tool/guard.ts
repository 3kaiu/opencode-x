export * as ToolGuard from "./guard"

import { Context, Effect, Layer, Ref, Scope } from "effect"
import * as Option from "effect/Option"
import { makeLocationNode } from "../effect/app-node"

/**
 * A monotonic deny-only guard. Returns `None` to allow, `Some(reason)` to deny.
 * Once any guard denies, no later guard or hook can overturn the decision.
 */
export type Guard = (tool: {
  readonly name: string
  readonly input: unknown
}) => Effect.Effect<Option.Option<string>>

export interface Interface {
  readonly register: (guard: Guard) => Effect.Effect<void, never, Scope.Scope>
  readonly check: (tool: {
    readonly name: string
    readonly input: unknown
  }) => Effect.Effect<Option.Option<string>>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/ToolGuard") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const guards = yield* Ref.make<ReadonlyArray<Guard>>([])

    const check = Effect.fn("ToolGuard.check")(function* (tool: {
      readonly name: string
      readonly input: unknown
    }) {
      const all = yield* Ref.get(guards)
      if (all.length === 0) return Option.none<string>()
      // Run all guards; take the first denial. A throwing guard degrades to
      // allow so a buggy plugin cannot deny every tool call.
      for (const guard of all) {
        const result = yield* guard(tool).pipe(
          Effect.catchCause(() => Effect.succeed(Option.none<string>())),
        )
        if (Option.isSome(result)) return result
      }
      return Option.none<string>()
    })

    return Service.of({
      register: Effect.fn("ToolGuard.register")(function* (guard: Guard) {
        yield* Ref.update(guards, (current) => [...current, guard])
        yield* Effect.addFinalizer(() =>
          Ref.update(guards, (current) => current.filter((item) => item !== guard)),
        )
      }),
      check,
    })
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [],
})
