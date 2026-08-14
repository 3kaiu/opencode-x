import { DateTime, Effect, Stream } from "effect"
import { and, asc, desc, eq, gt, like, lt, or, type SQL } from "drizzle-orm"
import { SessionDurable } from "@opencode-ai/schema/durable-event-manifest"
import { Event } from "../event"
import { Database } from "../database/database"
import { SessionMessage } from "./message"
import { SessionSchema } from "./schema"
import { SessionStore } from "./store"
import { SessionEvent } from "./event"
import { SessionTodo } from "./todo"
import { SessionExecution } from "./execution"
import { fromRow } from "./info"
import { MessageDecodeError } from "./error"
import { NotFoundError } from "./errors"
import { SessionMessageTable, SessionTable } from "./sql"
import { SessionV1 } from "../v1/session"
import { LocationServiceMap } from "../location-service-map"
import type { Interface } from "../session"

export const toV1Info = (session: SessionSchema.Info): SessionV1.SessionInfo => ({
  id: session.id,
  slug: session.id,
  version: "2",
  projectID: session.projectID,
  workspaceID: session.location.workspaceID,
  directory: session.location.directory,
  path: session.subpath,
  parentID: session.parentID,
  cost: session.cost,
  tokens: session.tokens,
  title: session.title,
  agent: session.agent,
  model: session.model
    ? { id: session.model.id, providerID: session.model.providerID, variant: session.model.variant }
    : undefined,
  time: {
    created: DateTime.toEpochMillis(session.time.created),
    updated: DateTime.toEpochMillis(session.time.updated),
    archived: session.time.archived ? DateTime.toEpochMillis(session.time.archived) : undefined,
    compacting: undefined,
  },
  revert: session.revert
    ? {
        messageID: session.revert.messageID as unknown as SessionV1.MessageID,
        partID: session.revert.partID as unknown as SessionV1.PartID | undefined,
        snapshot: session.revert.snapshot,
        diff: session.revert.diff,
      }
    : undefined,
  summary: undefined,
  share: undefined,
})

export interface QueryDependencies {
  readonly db: Database.Interface["db"]
  readonly store: SessionStore.Interface
  readonly events: Event.Interface
  readonly execution: SessionExecution.Interface
  readonly locations: LocationServiceMap.Service["Service"]
  readonly isDurableSessionEvent: (event: unknown) => event is SessionEvent.DurableEvent
  readonly decode: (
    row: typeof SessionMessageTable.$inferSelect,
  ) => Effect.Effect<SessionMessage.Message, MessageDecodeError>
  readonly getResult: () => Interface
}

export const makeQueryMethods = (deps: QueryDependencies) => {
  const result = deps.getResult
  return {
    get: Effect.fn("V2Session.get")(function* (sessionID) {
      const session = yield* deps.store.get(sessionID)
      if (!session) return yield* new NotFoundError({ sessionID })
      return session
    }),
    remove: Effect.fn("V2Session.remove")(function* (sessionID) {
      const session = yield* result().get(sessionID)
      const kids = yield* deps.db
        .select({ id: SessionTable.id })
        .from(SessionTable)
        .where(eq(SessionTable.parent_id, sessionID))
        .all()
        .pipe(Effect.orDie)
      for (const child of kids) {
        yield* result().remove(child.id)
      }
      yield* deps.events.publish(SessionV1.Event.Deleted, { sessionID, info: toV1Info(session) })
      yield* deps.events.remove(sessionID)
      yield* deps.db.delete(SessionTable).where(eq(SessionTable.id, sessionID)).run().pipe(Effect.orDie)
    }),
    update: Effect.fn("V2Session.update")(function* (input) {
      yield* result().get(input.sessionID)
      const set: Record<string, unknown> = { time_updated: Date.now() }
      if (input.title !== undefined) set["title"] = input.title
      if (input.metadata !== undefined) set["metadata"] = input.metadata
      if (input.archived !== undefined) set["time_archived"] = input.archived
      yield* deps.db.update(SessionTable).set(set).where(eq(SessionTable.id, input.sessionID)).run().pipe(Effect.orDie)
      const session = yield* result().get(input.sessionID).pipe(Effect.orDie)
      yield* deps.events.publish(SessionV1.Event.Updated, { sessionID: input.sessionID, info: toV1Info(session) })
      return session
    }),
    children: Effect.fn("V2Session.children")(function* (sessionID) {
      yield* result().get(sessionID)
      const rows = yield* deps.db
        .select()
        .from(SessionTable)
        .where(eq(SessionTable.parent_id, sessionID))
        .orderBy(desc(SessionTable.time_created))
        .all()
        .pipe(Effect.orDie)
      return rows.map((row) => fromRow(row))
    }),
    todo: Effect.fn("V2Session.todo")(function* (sessionID) {
      const session = yield* result().get(sessionID)
      const todoSvc = yield* SessionTodo.Service.pipe(Effect.provide(deps.locations.get(session.location)))
      return yield* todoSvc.get(sessionID)
    }),
    list: Effect.fn("V2Session.list")(function* (input = {}) {
      const direction = input.anchor?.direction ?? "next"
      const requestedOrder = input.order ?? "desc"
      const order = direction === "previous" ? (requestedOrder === "asc" ? "desc" : "asc") : requestedOrder
      const sortColumn = SessionTable.time_created
      const conditions: SQL[] = []
      if ("directory" in input) conditions.push(eq(SessionTable.directory, input.directory))
      if (input.workspaceID) conditions.push(eq(SessionTable.workspace_id, input.workspaceID))
      if ("project" in input) conditions.push(eq(SessionTable.project_id, input.project))
      if (input.search) conditions.push(like(SessionTable.title, `%${input.search}%`))
      if (input.anchor) {
        conditions.push(
          order === "asc"
            ? or(
                gt(sortColumn, input.anchor.time),
                and(eq(sortColumn, input.anchor.time), gt(SessionTable.id, input.anchor.id)),
              )!
            : or(
                lt(sortColumn, input.anchor.time),
                and(eq(sortColumn, input.anchor.time), lt(SessionTable.id, input.anchor.id)),
              )!,
        )
      }
      const query = deps.db
        .select()
        .from(SessionTable)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(
          order === "asc" ? asc(sortColumn) : desc(sortColumn),
          order === "asc" ? asc(SessionTable.id) : desc(SessionTable.id),
        )
      const rows = yield* (input.limit === undefined ? query.all() : query.limit(input.limit).all()).pipe(
        Effect.orDie,
      )
      return (direction === "previous" ? rows.toReversed() : rows).map((row) => fromRow(row))
    }),
    messages: Effect.fn("V2Session.messages")(function* (input) {
      yield* result().get(input.sessionID)
      const direction = input.cursor?.direction ?? "next"
      const requestedOrder = input.order ?? "desc"
      const order = direction === "previous" ? (requestedOrder === "asc" ? "desc" : "asc") : requestedOrder
      const anchor = input.cursor
        ? yield* deps.db
            .select({ seq: SessionMessageTable.seq })
            .from(SessionMessageTable)
            .where(
              and(eq(SessionMessageTable.session_id, input.sessionID), eq(SessionMessageTable.id, input.cursor.id)),
            )
            .get()
            .pipe(Effect.orDie)
        : undefined
      if (input.cursor && !anchor) return []
      const boundary = anchor
        ? order === "asc"
          ? gt(SessionMessageTable.seq, anchor.seq)
          : lt(SessionMessageTable.seq, anchor.seq)
        : undefined
      const where = boundary
        ? and(eq(SessionMessageTable.session_id, input.sessionID), boundary)
        : eq(SessionMessageTable.session_id, input.sessionID)
      const query = deps.db
        .select()
        .from(SessionMessageTable)
        .where(where)
        .orderBy(order === "asc" ? asc(SessionMessageTable.seq) : desc(SessionMessageTable.seq))
      const rows = yield* (input.limit === undefined ? query.all() : query.limit(input.limit).all()).pipe(
        Effect.orDie,
      )
      return yield* Effect.forEach(direction === "previous" ? rows.toReversed() : rows, deps.decode)
    }),
    message: Effect.fn("V2Session.message")(function* (input: {
      sessionID: SessionSchema.ID
      messageID: SessionMessage.ID
    }) {
      const stored = yield* deps.store.message(input.messageID)
      return stored?.sessionID === input.sessionID ? stored.message : undefined
    }),
    context: Effect.fn("V2Session.context")(function* (sessionID) {
      yield* result().get(sessionID)
      return yield* deps.store.context(sessionID)
    }),
    events: (input: { sessionID: SessionSchema.ID; after?: number }) =>
      Stream.unwrap(
        result()
          .get(input.sessionID)
          .pipe(Effect.as(deps.events.durable({ aggregateID: input.sessionID, after: input.after }))),
      ).pipe(Stream.filter((event): event is SessionEvent.DurableEvent => deps.isDurableSessionEvent(event))),
    history: Effect.fn("V2Session.history")(function* (input: {
      sessionID: SessionSchema.ID
      after?: number
      limit: number
    }) {
      yield* result().get(input.sessionID)
      return yield* Event.readAggregate(deps.db, {
        ...input,
        aggregateID: input.sessionID,
        manifest: SessionDurable,
      })
    }),
    wait: Effect.fn("V2Session.wait")(function* (sessionID) {
      yield* result().get(sessionID)
      yield* deps.execution.awaitIdle(sessionID)
    }),
    active: deps.execution.active,
  }
}
