import { Duration, Effect, Scope } from "effect"
import { DateTime } from "effect"
import { ChildProcess } from "effect/unstable/process"
import { Observability, type ObservabilityInterface } from "@opencode-ai/observability"
import { Prompt } from "./prompt"
import { PromptInput } from "@opencode-ai/schema/prompt-input"
import { Database } from "../database/database"
import { EventV2 } from "../event"
import { SessionMessage } from "./message"
import { SessionSchema } from "./schema"
import { SessionEvent } from "./event"
import { SessionInput } from "./input"
import { SessionExecution } from "./execution"
import { SessionRunner } from "./runner/index"
import { LocationServiceMap } from "../location-service-map"
import { SkillV2 } from "../skill"
import { Identifier } from "../util/identifier"
import { Shell } from "../shell"
import { KeyedMutex } from "../effect/keyed-mutex"
import { AppProcess } from "../process"
import { Config } from "../config"
import { FSUtil } from "../fs-util"
import { OperationUnavailableError, PromptConflictError, SkillNotFoundError } from "./errors"
import type { Interface } from "../session"
import type { ModelV2 } from "../model"

export const resolvePrompt = (input: PromptInput.Prompt) =>
  Prompt.make({
    text: input.text,
    agents: input.agents,
    files: input.files?.map((file) => {
      const dataMime = file.uri.match(/^data:([^;,]+)[;,]/i)?.[1]
      const target = URL.canParse(file.uri) ? new URL(file.uri).pathname : (file.name ?? file.uri)
      return {
        ...file,
        mime: dataMime ?? (target.endsWith("/") ? "application/x-directory" : FSUtil.mimeType(target)),
      }
    }),
  })

// Mirrors the shell tool's in-memory preview safety limit.
const SHELL_MAX_CAPTURE_BYTES = 1024 * 1024

export interface ControlsDependencies {
  readonly db: Database.Interface["db"]
  readonly events: EventV2.Interface
  readonly execution: SessionExecution.Interface
  readonly locations: LocationServiceMap.Service["Service"]
  readonly appProcess: AppProcess.Interface
  readonly scope: Scope.Scope
  readonly observability: ObservabilityInterface | undefined
  readonly activeShells: Set<SessionSchema.ID>
  readonly pendingResume: Set<SessionSchema.ID>
  readonly shellLocks: ReturnType<typeof KeyedMutex.makeUnsafe<SessionSchema.ID>>
  readonly getResult: () => Interface
}

export const makeControlsMethods = (deps: ControlsDependencies) => {
  const result = deps.getResult
  // Session shell is user-initiated and synchronous at the API boundary. The
  // upstream location Shell service is not at this HEAD yet, so run through
  // AppProcess with the v1 user-facing shell selection semantics.
  const runShellCommand = (command: string, cwd: string) =>
    Effect.gen(function* () {
      const config = yield* Config.Service
      const sh = Shell.preferred(Config.latest(yield* config.entries(), "shell"))
      const res = yield* deps.appProcess.run(
        ChildProcess.make(sh, Shell.args(sh, command, cwd), {
          cwd,
          extendEnv: true,
          env: { TERM: "dumb" },
          stdin: "ignore",
          forceKillAfter: Duration.seconds(3),
        }),
        { combineOutput: true, maxOutputBytes: SHELL_MAX_CAPTURE_BYTES },
      )
      return res.output?.toString("utf8") || "(no output)"
    }).pipe(Effect.catchTag("AppProcessError", (error) => Effect.succeed(error.message)))

  return {
    prompt: Effect.fn("V2Session.prompt")((input) =>
      Effect.uninterruptible(
        Effect.gen(function* () {
          yield* result().get(input.sessionID)
          const prompt = resolvePrompt(input.prompt)
          const messageID = input.id ?? SessionMessage.ID.create()
          const delivery = input.delivery ?? "steer"
          const expected = { sessionID: input.sessionID, messageID, prompt, delivery }
          const admitted = yield* SessionInput.admit(deps.db, deps.events, {
            id: messageID,
            sessionID: input.sessionID,
            prompt,
            delivery,
          }).pipe(
            Effect.catchDefect((defect) =>
              defect instanceof SessionInput.LifecycleConflict
                ? new PromptConflictError({ sessionID: input.sessionID, messageID })
                : Effect.die(defect),
            ),
          )
          if (!SessionInput.equivalent(admitted, expected)) {
            deps.observability?.record("counter", "session.prompt.conflict", { delivery }, 1)
            return yield* new PromptConflictError({ sessionID: input.sessionID, messageID })
          }
          deps.observability?.record("counter", "session.prompt.admitted", { delivery }, 1)
          if (input.resume !== false) {
            if (deps.activeShells.has(admitted.sessionID)) return admitted
            yield* deps.execution.wake(admitted.sessionID)
          }
          return admitted
        }),
      ),
    ),
    shell: Effect.fn("V2Session.shell")(function* (input) {
      const session = yield* result().get(input.sessionID)
      yield* deps.shellLocks.withLock(input.sessionID)(
        Effect.gen(function* () {
          deps.activeShells.add(input.sessionID)
          if ((yield* deps.execution.active).has(input.sessionID)) yield* deps.execution.awaitIdle(input.sessionID)
          const messageID = SessionMessage.ID.create()
          const callID = Identifier.ascending()
          yield* deps.events.publish(
            SessionEvent.Shell.Started,
            {
              sessionID: input.sessionID,
              messageID,
              callID,
              command: input.command,
              timestamp: yield* DateTime.now,
            },
            { id: input.id },
          )
          const output = yield* runShellCommand(input.command, session.location.directory).pipe(
            Effect.provide(deps.locations.get(session.location)),
          )
          yield* deps.events.publish(SessionEvent.Shell.Ended, {
            sessionID: input.sessionID,
            callID,
            output,
            timestamp: yield* DateTime.now,
          })
        }).pipe(
          Effect.ensuring(
            Effect.gen(function* () {
              deps.activeShells.delete(input.sessionID)
              // A skill activation or resume requested while the shell ran is
              // applied now that the shell is done; otherwise a plain wake
              // covers inputs admitted in the meantime.
              if (deps.pendingResume.delete(input.sessionID)) {
                yield* deps.execution
                  .resume(input.sessionID)
                  .pipe(Effect.ignore, Effect.forkIn(deps.scope, { startImmediately: true }), Effect.asVoid)
                return
              }
              yield* deps.execution.wake(input.sessionID)
            }),
          ),
        ),
      )
    }),
    skill: Effect.fn("V2Session.skill")(function* (input) {
      const session = yield* result().get(input.sessionID)
      const skills = yield* SkillV2.Service.pipe(Effect.provide(deps.locations.get(session.location)))
      const skill = (yield* skills.list()).find((item) => item.name === input.skill)
      if (!skill) return yield* new SkillNotFoundError({ skill: input.skill })
      yield* deps.events.publish(SessionEvent.Skill.Activated, {
        sessionID: input.sessionID,
        messageID: input.id ?? SessionMessage.ID.create(),
        timestamp: yield* DateTime.now,
        name: skill.name,
        text: skill.content,
      })
      if (input.resume !== false) {
        if (deps.activeShells.has(input.sessionID)) {
          deps.pendingResume.add(input.sessionID)
          return
        }
        yield* deps.execution
          .resume(input.sessionID)
          .pipe(Effect.ignore, Effect.forkIn(deps.scope, { startImmediately: true }), Effect.asVoid)
      }
    }),
    switchAgent: Effect.fn("V2Session.switchAgent")(function* (input) {
      yield* result().get(input.sessionID)
      yield* deps.events.publish(SessionEvent.AgentSwitched, {
        sessionID: input.sessionID,
        messageID: SessionMessage.ID.create(),
        timestamp: yield* DateTime.now,
        agent: input.agent,
      })
    }),
    switchModel: Effect.fn("V2Session.switchModel")(function* (input: {
      sessionID: SessionSchema.ID
      model: ModelV2.Ref
    }) {
      const session = yield* result().get(input.sessionID)
      if (
        session.model?.providerID === input.model.providerID &&
        session.model.id === input.model.id &&
        (session.model.variant ?? "default") === (input.model.variant ?? "default")
      )
        return
      yield* deps.events.publish(SessionEvent.ModelSwitched, {
        sessionID: input.sessionID,
        messageID: SessionMessage.ID.create(),
        timestamp: yield* DateTime.now,
        model: input.model,
      })
    }),
    compact: Effect.fn("V2Session.compact")(function* (input) {
      const session = yield* result().get(input.sessionID)
      const compacted = yield* Effect.gen(function* () {
        const runner = yield* SessionRunner.Service
        return yield* runner.compact({ sessionID: session.id, instructions: input.prompt?.text || undefined })
      }).pipe(
        Effect.provide(deps.locations.get(session.location)),
        Effect.catchCause((cause) =>
          Effect.gen(function* () {
            yield* Effect.logError("session compact failed", { sessionID: session.id, cause })
            return false
          }),
        ),
      )
      if (!compacted) return yield* new OperationUnavailableError({ operation: "compact" })
    }),
    resume: Effect.fn("V2Session.resume")(function* (sessionID) {
      yield* result().get(sessionID)
      if (deps.activeShells.has(sessionID)) {
        deps.pendingResume.add(sessionID)
        return
      }
      yield* deps.execution.resume(sessionID)
    }),
    interrupt: Effect.fn("V2Session.interrupt")((sessionID) =>
      Effect.uninterruptible(deps.execution.interrupt(sessionID)),
    ),
  }
}
