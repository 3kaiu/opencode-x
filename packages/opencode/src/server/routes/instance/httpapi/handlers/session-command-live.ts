import { Effect, Layer, Option } from "effect"
import { SessionCommand } from "@opencode-ai/server/session-command"
import { runCommandV2 } from "@/session/command-v2"
import { InstanceState } from "@/effect/instance-state"
import { Command } from "@/command"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Session } from "@opencode-ai/core/session"
import { SessionStore } from "@opencode-ai/core/session/store"
import { SessionExecution } from "@opencode-ai/core/session/execution"
import { LocationServiceMap } from "@opencode-ai/core/location-services"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"

export const SessionCommandLive = Layer.effect(
  SessionCommand.Service,
  Effect.gen(function* () {
    const commands = yield* Command.Service
    const fs = yield* FSUtil.Service
    const session = yield* Session.Service
    const store = yield* SessionStore.Service
    const execution = yield* SessionExecution.Service
    const locations = yield* LocationServiceMap.Service
    return SessionCommand.Service.of({
      run: (input) =>
        Effect.gen(function* () {
          const ctx = yield* InstanceState.context
          const recorded = yield* store.get(input.sessionID)
          if (recorded === undefined) return yield* Effect.fail(new Error(`Session not found: ${input.sessionID}`))
          yield* runCommandV2({ ...input, worktree: ctx.worktree }).pipe(
            Effect.provideService(Command.Service, commands),
            Effect.provideService(FSUtil.Service, fs),
            Effect.provideService(Session.Service, session),
            Effect.provideService(SessionExecution.Service, execution),
            Effect.provide(locations.get(recorded.location)),
            Effect.mapError((error) => new Error(error instanceof Error ? error.message : String(error))),
            // LocationServices markers are not erased by the type system here;
            // the location layer is provided above, so this is runtime-safe.
          ) as Effect.Effect<void, Error, never>
        }),
    })
  }),
)

// Node form: declares its dependencies so the Session graph orders and
// provides them (construction happens after the whole graph is composed).
export const SessionCommandLiveNode = LayerNode.make({
  service: SessionCommand.Service,
  layer: SessionCommandLive,
  deps: [
    Command.node,
    FSUtil.node,
    Session.node,
    SessionStore.node,
    SessionExecution.node,
    LocationServiceMap.node,
  ],
})
