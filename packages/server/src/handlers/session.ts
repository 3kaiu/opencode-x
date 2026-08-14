import { Session } from "@opencode-ai/core/session"
import { SessionCommand } from "@opencode-ai/server/session-command"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { DateTime, Effect, Encoding, Result, Schema, Stream } from "effect"
import { HttpApiBuilder, HttpApiSchema } from "effect/unstable/httpapi"
import { HttpServerResponse } from "effect/unstable/http"
import * as Sse from "effect/unstable/encoding/Sse"
import { Api } from "../api"
import { SessionsCursor } from "@opencode-ai/protocol/groups/session"
import {
  ConflictError,
  InvalidCursorError,
  MessageNotFoundError,
  ServiceUnavailableError,
  SessionNotFoundError,
  SkillNotFoundError,
  UnknownError,
} from "@opencode-ai/protocol/errors"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { appendFileSync } from "node:fs"

const serverBootTime = Date.now()
const serverLogEnabled = process.env.OPENCODE_DEBUG_LOG === "1"

function serverLog(...args: unknown[]) {
  if (!serverLogEnabled) return
  const line =
    `+${Date.now() - serverBootTime}ms ` +
    args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ") +
    "\n"
  try {
    appendFileSync("/tmp/opencode-worker-debug.log", line)
  } catch {
    // never let logging break the server
  }
}

const DefaultSessionsLimit = 50
const DefaultSessionHistoryLimit = 50
const DefaultMessagesLimit = 50

const MessagesCursorInput = Schema.Struct({
  id: SessionMessage.ID,
  direction: Schema.Union([Schema.Literal("previous"), Schema.Literal("next")]),
})
const MessagesCursorJson = Schema.fromJsonString(MessagesCursorInput)
const encodeMessagesCursor = Schema.encodeSync(MessagesCursorJson)
const decodeMessagesCursor = Schema.decodeUnknownEffect(MessagesCursorJson)

const MessagesCursor = {
  make: (input: typeof MessagesCursorInput.Type) => Encoding.encodeBase64Url(encodeMessagesCursor(input)),
  parse: (input: string) =>
    Effect.suspend(() => {
      const result = Encoding.decodeBase64UrlString(input)
      return Result.isFailure(result)
        ? Effect.fail("Invalid cursor" as const)
        : decodeMessagesCursor(result.success).pipe(Effect.mapError(() => "Invalid cursor" as const))
    }),
}

export const SessionHandler = HttpApiBuilder.group(Api, "server.session", (handlers) =>
  Effect.gen(function* () {
    const session = yield* Session.Service
    const cmd = yield* SessionCommand.Service

    return handlers
      .handle(
        "session.list",
        Effect.fn(function* (ctx) {
          const query =
            ctx.query.cursor !== undefined
              ? yield* SessionsCursor.parse(ctx.query.cursor).pipe(
                  Effect.mapError(() => new InvalidCursorError({ message: "Invalid cursor" })),
                )
              : ctx.query
          const sessions = yield* session.list({
            ...query,
            workspaceID: query.workspace,
            limit: ctx.query.limit ?? DefaultSessionsLimit,
          })
          const first = sessions[0]
          const last = sessions.at(-1)
          return {
            data: sessions,
            cursor: {
              previous: first
                ? SessionsCursor.make({
                    ...query,
                    anchor: {
                      id: first.id,
                      time: DateTime.toEpochMillis(first.time.created),
                      direction: "previous",
                    },
                  })
                : undefined,
              next: last
                ? SessionsCursor.make({
                    ...query,
                    anchor: {
                      id: last.id,
                      time: DateTime.toEpochMillis(last.time.created),
                      direction: "next",
                    },
                  })
                : undefined,
            },
          }
        }),
      )
      .handle(
        "session.create",
        Effect.fn(function* (ctx) {
          return {
            data: yield* session.create({
              id: ctx.payload.id,
              agent: ctx.payload.agent,
              model: ctx.payload.model,
              location: ctx.payload.location ?? { directory: AbsolutePath.make(process.cwd()) },
            }),
          }
        }),
      )
      .handle(
        "session.active",
        Effect.fn(function* () {
          return {
            data: Object.fromEntries(
              Array.from(yield* session.active, (sessionID) => [sessionID, { type: "running" as const }]),
            ),
          }
        }),
      )
      .handle(
        "session.get",
        Effect.fn(function* (ctx) {
          return {
            data: yield* session.get(ctx.params.sessionID).pipe(
              Effect.catchTag(
                "Session.NotFoundError",
                (error) =>
                  new SessionNotFoundError({
                    sessionID: error.sessionID,
                    message: `Session not found: ${error.sessionID}`,
                  }),
              ),
            ),
          }
        }),
      )
      .handle(
        "session.switchAgent",
        Effect.fn(function* (ctx) {
          yield* session.switchAgent({ sessionID: ctx.params.sessionID, agent: ctx.payload.agent }).pipe(
            Effect.catchTag("Session.NotFoundError", (error) =>
              Effect.fail(
                new SessionNotFoundError({
                  sessionID: error.sessionID,
                  message: `Session not found: ${error.sessionID}`,
                }),
              ),
            ),
          )
          return HttpApiSchema.NoContent.make()
        }),
      )
      .handle(
        "session.switchModel",
        Effect.fn(function* (ctx) {
          yield* session.switchModel({ sessionID: ctx.params.sessionID, model: ctx.payload.model }).pipe(
            Effect.catchTag("Session.NotFoundError", (error) =>
              Effect.fail(
                new SessionNotFoundError({
                  sessionID: error.sessionID,
                  message: `Session not found: ${error.sessionID}`,
                }),
              ),
            ),
          )
          return HttpApiSchema.NoContent.make()
        }),
      )
      .handle(
        "session.prompt",
        Effect.fn(function* (ctx) {
          const start = Date.now()
          const admitted = yield* session
            .prompt({
              sessionID: ctx.params.sessionID,
              id: ctx.payload.id,
              prompt: ctx.payload.prompt,
              delivery: ctx.payload.delivery,
              resume: ctx.payload.resume,
            })
            .pipe(
              Effect.catchTag("Session.NotFoundError", (error) =>
                Effect.fail(
                  new SessionNotFoundError({
                    sessionID: error.sessionID,
                    message: `Session not found: ${error.sessionID}`,
                  }),
                ),
              ),
              Effect.catchTag("Session.PromptConflictError", (error) =>
                Effect.fail(
                  new ConflictError({
                    message: `Prompt message ID conflicts with an existing durable record: ${error.messageID}`,
                    resource: error.messageID,
                  }),
                ),
              ),
            )
          serverLog("[server:prompt]", ctx.params.sessionID, "admitted:", admitted.id, "delivery:", admitted.delivery, `${Date.now() - start}ms`)
          return { data: admitted }
        }),
      )
      .handle(
        "session.shell",
        Effect.fn(function* (ctx) {
          yield* session
            .shell({ sessionID: ctx.params.sessionID, id: ctx.payload.id, command: ctx.payload.command })
            .pipe(
              Effect.catchTag("Session.NotFoundError", (error) =>
                Effect.fail(
                  new SessionNotFoundError({
                    sessionID: error.sessionID,
                    message: `Session not found: ${error.sessionID}`,
                  }),
                ),
              ),
            )
          return HttpApiSchema.NoContent.make()
        }),
      )
      .handle(
        "session.command",
        Effect.fn(function* (ctx) {
          yield* session.get(ctx.params.sessionID).pipe(
            Effect.catchTag("Session.NotFoundError", (error) =>
              Effect.fail(
                new SessionNotFoundError({
                  sessionID: error.sessionID,
                  message: `Session not found: ${error.sessionID}`,
                }),
              ),
            ),
          )
          yield* cmd.run({ ...ctx.payload, sessionID: ctx.params.sessionID }).pipe(
            Effect.mapError((error) => {
              const msg = error instanceof Error ? error.message : String(error)
              return new UnknownError({ message: msg })
            }),
          )
          return HttpApiSchema.NoContent.make()
        }),
      )
      .handle(
        "session.skill",
        Effect.fn(function* (ctx) {
          yield* session
            .skill({
              sessionID: ctx.params.sessionID,
              id: ctx.payload.id,
              skill: ctx.payload.skill,
              resume: ctx.payload.resume,
            })
            .pipe(
              Effect.catchTag("Session.NotFoundError", (error) =>
                Effect.fail(
                  new SessionNotFoundError({
                    sessionID: error.sessionID,
                    message: `Session not found: ${error.sessionID}`,
                  }),
                ),
              ),
              Effect.catchTag("Session.SkillNotFoundError", (error) =>
                Effect.fail(new SkillNotFoundError({ skill: error.skill, message: `Skill not found: ${error.skill}` })),
              ),
            )
          return HttpApiSchema.NoContent.make()
        }),
      )
      .handle(
        "session.compact",
        Effect.fn(function* (ctx) {
          yield* session.compact({ sessionID: ctx.params.sessionID }).pipe(
            Effect.catchTag("Session.NotFoundError", (error) =>
              Effect.fail(
                new SessionNotFoundError({
                  sessionID: error.sessionID,
                  message: `Session not found: ${error.sessionID}`,
                }),
              ),
            ),
            Effect.catchTag("Session.OperationUnavailableError", (error) =>
              Effect.fail(
                new ServiceUnavailableError({
                  message: `Session ${error.operation} is not available yet`,
                  service: `session.${error.operation}`,
                }),
              ),
            ),
          )
          return HttpApiSchema.NoContent.make()
        }),
      )
      .handle(
        "session.wait",
        Effect.fn(function* (ctx) {
          yield* session.wait(ctx.params.sessionID).pipe(
            Effect.catchTag("Session.NotFoundError", (error) =>
              Effect.fail(
                new SessionNotFoundError({
                  sessionID: error.sessionID,
                  message: `Session not found: ${error.sessionID}`,
                }),
              ),
            ),
          )
          return HttpApiSchema.NoContent.make()
        }),
      )
      .handle(
        "session.revert.stage",
        Effect.fn(function* (ctx) {
          return {
            data: yield* session.revert.stage({ ...ctx.params, ...ctx.payload }).pipe(
              Effect.catchTag(
                "Session.NotFoundError",
                (error) =>
                  new SessionNotFoundError({
                    sessionID: error.sessionID,
                    message: `Session not found: ${error.sessionID}`,
                  }),
              ),
              Effect.catchTag(
                "Session.MessageNotFoundError",
                (error) =>
                  new MessageNotFoundError({
                    sessionID: error.sessionID,
                    messageID: error.messageID,
                    message: `Message not found: ${error.messageID}`,
                  }),
              ),
              Effect.catchTag("Snapshot.Error", (error) => {
                const ref = `err_${crypto.randomUUID().slice(0, 8)}`
                return Effect.logError("failed to stage session revert", { cause: error }).pipe(
                  Effect.andThen(
                    Effect.fail(
                      new UnknownError({
                        message: "Unexpected server error. Check server logs for details.",
                        ref,
                      }),
                    ),
                  ),
                )
              }),
            ),
          }
        }),
      )
      .handle(
        "session.revert.clear",
        Effect.fn(function* (ctx) {
          yield* session.revert.clear(ctx.params.sessionID).pipe(
            Effect.catchTag(
              "Session.NotFoundError",
              (error) =>
                new SessionNotFoundError({
                  sessionID: error.sessionID,
                  message: `Session not found: ${error.sessionID}`,
                }),
            ),
            Effect.catchTag("Snapshot.Error", (error) => {
              const ref = `err_${crypto.randomUUID().slice(0, 8)}`
              return Effect.logError("failed to clear session revert", { cause: error }).pipe(
                Effect.andThen(
                  Effect.fail(
                    new UnknownError({
                      message: "Unexpected server error. Check server logs for details.",
                      ref,
                    }),
                  ),
                ),
              )
            }),
          )
          return HttpApiSchema.NoContent.make()
        }),
      )
      .handle(
        "session.revert.commit",
        Effect.fn(function* (ctx) {
          yield* session.revert.commit(ctx.params.sessionID).pipe(
            Effect.catchTag(
              "Session.NotFoundError",
              (error) =>
                new SessionNotFoundError({
                  sessionID: error.sessionID,
                  message: `Session not found: ${error.sessionID}`,
                }),
            ),
          )
          return HttpApiSchema.NoContent.make()
        }),
      )
      .handle(
        "session.context",
        Effect.fn(function* (ctx) {
          return {
            data: yield* session.context(ctx.params.sessionID).pipe(
              Effect.catchTag("Session.NotFoundError", (error) =>
                Effect.fail(
                  new SessionNotFoundError({
                    sessionID: error.sessionID,
                    message: `Session not found: ${error.sessionID}`,
                  }),
                ),
              ),
              Effect.catchTag("Session.MessageDecodeError", (error) => {
                const ref = `err_${crypto.randomUUID().slice(0, 8)}`
                return Effect.logError("failed to decode session message").pipe(
                  Effect.annotateLogs({ ref, sessionID: error.sessionID, messageID: error.messageID }),
                  Effect.andThen(
                    Effect.fail(
                      new UnknownError({ message: "Unexpected server error. Check server logs for details.", ref }),
                    ),
                  ),
                )
              }),
            ),
          }
        }),
      )
      .handle(
        "session.history",
        Effect.fn(function* (ctx) {
          return yield* session
            .history({
              sessionID: ctx.params.sessionID,
              after: ctx.query.after,
              limit: ctx.query.limit ?? DefaultSessionHistoryLimit,
            })
            .pipe(
              Effect.map((page) => ({
                data: page.events,
                hasMore: page.hasMore,
              })),
              Effect.catchTag(
                "Session.NotFoundError",
                (error) =>
                  new SessionNotFoundError({
                    sessionID: error.sessionID,
                    message: `Session not found: ${error.sessionID}`,
                  }),
              ),
            )
        }),
      )
            .handleRaw(
        "session.events",
        Effect.fn("SessionHandler.events")(function* (ctx) {
          const sessionID = ctx.params.sessionID
          yield* session.get(sessionID).pipe(
            Effect.catchTag("Session.NotFoundError", (error) =>
              Effect.fail(
                new SessionNotFoundError({
                  sessionID: error.sessionID,
                  message: `Session not found: ${sessionID}`,
                }),
              ),
            ),
          )
          const url = new URL(ctx.request.url, "http://localhost")
          const fromHeader = ctx.request.headers["last-event-id"]
          const rawAfter = fromHeader ?? (url.searchParams.get("after") ?? undefined)
          const after = rawAfter === undefined ? undefined : Number(rawAfter)
          const output = session.events({ sessionID, after }).pipe(
            Stream.orDie,
            Stream.map((event) => ({
              _tag: "Event" as const,
              event: "message",
              id: event.durable ? String(event.durable.seq) : undefined,
              data: JSON.stringify(event),
            })),
            Stream.pipeThroughChannel(Sse.encode()),
          )
          const heartbeat = Stream.tick(15).pipe(Stream.map(() => ": heartbeat\n\n"))
          return HttpServerResponse.stream(
            output.pipe(Stream.merge(heartbeat, { haltStrategy: "left" }), Stream.encodeText),
            {
              contentType: "text/event-stream",
              headers: {
                "Cache-Control": "no-cache, no-transform",
                "X-Accel-Buffering": "no",
                "X-Content-Type-Options": "nosniff",
              },
            },
          )
        }),
      )
      .handle(
        "session.interrupt",
        Effect.fn(function* (ctx) {
          yield* session.interrupt(ctx.params.sessionID)
          return HttpApiSchema.NoContent.make()
        }),
      )
      .handle(
        "session.message",
        Effect.fn(function* (ctx) {
          const message = yield* session.message(ctx.params)
          if (message) return { data: message }
          return yield* new MessageNotFoundError({
            sessionID: ctx.params.sessionID,
            messageID: ctx.params.messageID,
            message: `Message not found: ${ctx.params.messageID}`,
          })
        }),
      )
      .handle(
        "session.remove",
        Effect.fn(function* (ctx) {
          yield* session.remove(ctx.params.sessionID).pipe(
            Effect.catchTag(
              "Session.NotFoundError",
              (error) =>
                new SessionNotFoundError({
                  sessionID: error.sessionID,
                  message: `Session not found: ${error.sessionID}`,
                }),
            ),
          )
          return HttpApiSchema.NoContent.make()
        }),
      )
      .handle(
        "session.update",
        Effect.fn(function* (ctx) {
          return {
            data: yield* session
              .update({
                sessionID: ctx.params.sessionID,
                title: ctx.payload.title,
                metadata: ctx.payload.metadata,
                archived: ctx.payload.archived,
              })
              .pipe(
                Effect.catchTag(
                  "Session.NotFoundError",
                  (error) =>
                    new SessionNotFoundError({
                      sessionID: error.sessionID,
                      message: `Session not found: ${error.sessionID}`,
                    }),
                ),
              ),
          }
        }),
      )
      .handle(
        "session.fork",
        Effect.fn(function* (ctx) {
          return {
            data: yield* session
              .fork({ sessionID: ctx.params.sessionID, atSeq: ctx.payload.atSeq, atMessageID: ctx.payload.atMessageID })
              .pipe(
                Effect.catchTag(
                  "Session.NotFoundError",
                  (error) =>
                    new SessionNotFoundError({
                      sessionID: error.sessionID,
                      message: `Session not found: ${error.sessionID}`,
                    }),
                ),
              ),
          }
        }),
      )
      .handle(
        "session.children",
        Effect.fn(function* (ctx) {
          return {
            data: yield* session.children(ctx.params.sessionID).pipe(
              Effect.catchTag(
                "Session.NotFoundError",
                (error) =>
                  new SessionNotFoundError({
                    sessionID: error.sessionID,
                    message: `Session not found: ${error.sessionID}`,
                  }),
              ),
            ),
          }
        }),
      )
      .handle(
        "session.todo",
        Effect.fn(function* (ctx) {
          return {
            data: yield* session.todo(ctx.params.sessionID).pipe(
              Effect.catchTag(
                "Session.NotFoundError",
                (error) =>
                  new SessionNotFoundError({
                    sessionID: error.sessionID,
                    message: `Session not found: ${error.sessionID}`,
                  }),
              ),
            ),
          }
        }),
      )
      .handle(
        "session.messages",
        Effect.fn(function* (ctx) {
          const cursor = ctx.query.cursor
            ? yield* MessagesCursor.parse(ctx.query.cursor).pipe(
                Effect.mapError(() => new InvalidCursorError({ message: "Invalid cursor" })),
              )
            : undefined
          const messages = yield* session
            .messages({
              sessionID: ctx.params.sessionID,
              limit: ctx.query.limit ?? DefaultMessagesLimit,
              order: ctx.query.order,
              cursor: cursor
                ? { id: cursor.id, direction: cursor.direction }
                : undefined,
            })
            .pipe(
              Effect.catchTag(
                "Session.NotFoundError",
                (error) =>
                  new SessionNotFoundError({
                    sessionID: error.sessionID,
                    message: `Session not found: ${error.sessionID}`,
                  }),
              ),
              Effect.catchTag("Session.MessageDecodeError", (error) => {
                const ref = `err_${crypto.randomUUID().slice(0, 8)}`
                return Effect.logError("failed to decode session message").pipe(
                  Effect.annotateLogs({ ref, sessionID: error.sessionID, messageID: error.messageID }),
                  Effect.andThen(
                    Effect.fail(
                      new UnknownError({ message: "Unexpected server error. Check server logs for details.", ref }),
                    ),
                  ),
                )
              }),
            )
          const first = messages[0]
          const last = messages.at(-1)
          return {
            data: messages,
            cursor: {
              previous: first
                ? MessagesCursor.make({ id: first.id, direction: "previous" })
                : undefined,
              next: last
                ? MessagesCursor.make({ id: last.id, direction: "next" })
                : undefined,
            },
          }
        }),
      )
  }),
)
