export * as SessionCommand from "./session-command"

import { Context, Effect, Layer } from "effect"
import { makeGlobalNode } from "@opencode-ai/core/effect/app-node"
import { Session } from "@opencode-ai/schema/session"

export interface SessionCommandInput {
  readonly sessionID: Session.ID
  readonly command: string
  readonly arguments: string
  readonly agent?: string
  readonly model?: string
  readonly variant?: string
  readonly parts?: ReadonlyArray<{
    readonly uri: string
    readonly name?: string
    readonly description?: string
  }>
}

export interface Interface {
  readonly run: (input: SessionCommandInput) => Effect.Effect<void, Error>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/ServerSessionCommand") {}

export const layer = Layer.succeed(
  Service,
  Service.of({
    run: () => Effect.die("SessionCommand.Service not configured"),
  }),
)

export const node = makeGlobalNode({ service: Service, layer, deps: [] })
