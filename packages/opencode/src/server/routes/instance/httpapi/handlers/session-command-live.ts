import { Effect, Layer } from "effect"
import { SessionCommand } from "@opencode-ai/server/session-command"
import { SessionPrompt } from "@/session/prompt"

export const SessionCommandLive = Layer.effect(
  SessionCommand.Service,
  Effect.gen(function* () {
    const promptSvc = yield* SessionPrompt.Service
    return SessionCommand.Service.of({
      run: (input) =>
        Effect.gen(function* () {
          const parts = input.parts?.map((p) => ({
            type: "file" as const,
            url: p.uri,
            mime: "",
            ...(p.name ? { filename: p.name } : {}),
          }))
          yield* promptSvc.command({
            command: input.command,
            arguments: input.arguments,
            sessionID: input.sessionID,
            ...(input.agent ? { agent: input.agent } : {}),
            ...(input.model ? { model: input.model } : {}),
            ...(input.variant ? { variant: input.variant } : {}),
            ...(parts ? { parts } : {}),
          })
        }),
    })
  }),
)
