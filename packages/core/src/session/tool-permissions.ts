export * as SessionToolPermissions from "./tool-permissions"

import { Context, Effect, Layer, Ref } from "effect"
import { makeLocationNode } from "../effect/app-node"
import { Permission } from "../permission"
import { SessionSchema } from "./schema"

// Per-session tool permission overrides consulted by the runner before falling back to the
// selected agent's permissions. Subagent creation uses this to preserve the read-only subagent
// default without changing the durable runner's agent-permission resolution. In-memory and
// Location-scoped: overrides are cleared once the subagent run that set them completes, so the
// map stays bounded by the set of in-flight subagents rather than the process lifetime.
export interface Interface {
  readonly set: (sessionID: SessionSchema.ID, rules: Permission.Ruleset) => Effect.Effect<void>
  readonly get: (sessionID: SessionSchema.ID) => Effect.Effect<Permission.Ruleset | undefined>
  readonly delete: (sessionID: SessionSchema.ID) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/SessionToolPermissions") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const overrides = yield* Ref.make(new Map<SessionSchema.ID, Permission.Ruleset>())
    return Service.of({
      set: (sessionID, rules) => Ref.update(overrides, (current) => new Map(current).set(sessionID, rules)),
      get: (sessionID) => Ref.get(overrides).pipe(Effect.map((current) => current.get(sessionID))),
      delete: (sessionID) =>
        Ref.update(overrides, (current) => {
          if (!current.has(sessionID)) return current
          const next = new Map(current)
          next.delete(sessionID)
          return next
        }),
    })
  }),
)

export const node = makeLocationNode({ service: Service, layer, deps: [] })
