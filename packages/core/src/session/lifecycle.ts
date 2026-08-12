import path from "path"
import { Effect } from "effect"
import { eq } from "drizzle-orm"
import { EventV2 } from "../event"
import { Database } from "../database/database"
import { SessionMessage } from "./message"
import { SessionSchema } from "./schema"
import { SessionStore } from "./store"
import { SessionV1 } from "../v1/session"
import { InstallationVersion } from "../installation/version"
import { Slug } from "../util/slug"
import { ProjectTable } from "../project/sql"
import { SessionTable, SessionMessageTable } from "./sql"
import { SessionRevert } from "./revert"
import { SessionProjector } from "./projector"
import { LocationServiceMap } from "../location-service-map"
import { ProjectV2 } from "../project"
import { WorkspaceV2 } from "../workspace"
import { ModelV2 } from "../model"
import type { Location } from "../location"
import type { AgentV2 } from "../agent"
import type { Interface } from "../session"

export type CreateInput = {
  id?: SessionSchema.ID
  agent?: AgentV2.ID
  model?: ModelV2.Ref
  parentID?: SessionSchema.ID
  title?: string
  // Optional when parentID is given: the child inherits the parent Session's location.
  location?: Location.Ref
}

export interface LifecycleDependencies {
  readonly db: Database.Interface["db"]
  readonly database: Database.Interface
  readonly store: SessionStore.Interface
  readonly events: EventV2.Interface
  readonly locations: LocationServiceMap.Service["Service"]
  readonly projects: ProjectV2.Interface
  readonly getResult: () => Interface
}

export const makeLifecycleMethods = (deps: LifecycleDependencies) => {
  const result = deps.getResult
  const create = Effect.fn("V2Session.create")(function* (input: CreateInput) {
    const sessionID = input.id ?? SessionSchema.ID.create()
    const recorded = yield* deps.store.get(sessionID)
    if (recorded) return recorded
    // An explicit location wins; otherwise a child inherits its parent's location. The caller
    // is trusted here: this process-local API is invoked only by internal services (subagent
    // executor, prompt), never by a multi-principal HTTP/event surface. If the event bus or
    // session API is ever exposed to multiple principals, parent-location inheritance must be
    // gated on an ownership/authorization check.
    const parent = input.location === undefined && input.parentID ? yield* deps.store.get(input.parentID) : undefined
    const location = input.location ?? parent?.location
    if (location === undefined)
      return yield* Effect.die(new Error("V2Session.create requires either location or an existing parentID"))
    const project = yield* deps.projects.resolve(location.directory)
    yield* deps.db
      .insert(ProjectTable)
      .values({ id: project.id, worktree: project.directory, vcs: project.vcs?.type, sandboxes: [] })
      .onConflictDoNothing()
      .run()
      .pipe(Effect.orDie)
    const now = Date.now()
    const info = SessionV1.SessionInfo.make({
      id: sessionID,
      slug: Slug.create(),
      version: InstallationVersion,
      projectID: project.id,
      parentID: input.parentID,
      directory: location.directory,
      path: path.relative(project.directory, location.directory).replaceAll("\\", "/"),
      workspaceID: location.workspaceID ? WorkspaceV2.ID.make(location.workspaceID) : undefined,
      title: input.title ?? `New session - ${new Date(now).toISOString()}`,
      agent: input.agent,
      model: input.model
        ? {
            id: ModelV2.ID.make(input.model.id),
            providerID: input.model.providerID,
            variant: input.model.variant,
          }
        : undefined,
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      time: { created: now, updated: now },
    })
    const projected = yield* deps.events
      .publish(SessionV1.Event.Created, { sessionID, info }, { location })
      .pipe(
        Effect.as({ type: "created" } as const),
        Effect.catchDefect((defect) => {
          if (!(defect instanceof SessionProjector.SessionAlreadyProjected)) {
            return Effect.die(defect)
          }
          // Concurrent creation lost the projection race. The existing Session identity wins.
          return deps.store
            .get(sessionID)
            .pipe(
              Effect.flatMap((session) =>
                session ? Effect.succeed({ type: "existing", session } as const) : Effect.die(defect),
              ),
            )
        }),
      )
    if (projected.type === "existing") return projected.session
    // Recorded sessions restore onto replacement synchronized workspaces in a future API slice.
    return yield* result().get(sessionID).pipe(Effect.orDie)
  })

  const fork = Effect.fn("V2Session.fork")(function* (input: {
    sessionID: SessionSchema.ID
    atSeq?: number
    atMessageID?: SessionMessage.ID
  }) {
    const session = yield* result().get(input.sessionID)
    const newSessionID = SessionSchema.ID.create()

    // Create the fork through the durable pipeline so it owns a real aggregate, session row,
    // and Context Epoch lifecycle instead of a raw table write that bypasses the event core.
    // Forks are standalone sessions inheriting the source Location.
    yield* create({
      id: newSessionID,
      location: session.location,
      title: `Fork of ${session.title}`,
      agent: session.agent,
    })

    // Copy the source's projected messages with fresh IDs and sequential sequence numbers so
    // the fork keeps identical content without colliding on (session_id, seq) or the message
    // primary key.
    const messages = yield* deps.db
      .select()
      .from(SessionMessageTable)
      .where(eq(SessionMessageTable.session_id, input.sessionID))
      .all()
      .pipe(Effect.orDie)

    let atSeq = input.atSeq
    if (atSeq === undefined && input.atMessageID) {
      const anchor = messages.find((m) => m.id === input.atMessageID)
      atSeq = anchor?.seq
    }
    const filteredMessages = atSeq !== undefined
      ? messages.filter((m) => m.seq <= atSeq)
      : messages

    if (filteredMessages.length > 0) {
      yield* deps.db
        .insert(SessionMessageTable)
        .values(
          filteredMessages.map((msg, index) => ({
            id: SessionMessage.ID.create(),
            session_id: newSessionID,
            type: msg.type,
            seq: index + 1,
            time_created: msg.time_created,
            data: msg.data,
          })),
        )
        .run()
        .pipe(Effect.orDie)
    }

    // Advance the fork's durable aggregate sequence past the copied messages so the next
    // durable event (for example the first prompted input) continues at
    // `filteredMessages.length + 1` instead of colliding with the copied sequence range.
    yield* EventV2.advanceSequence(deps.db, newSessionID, filteredMessages.length)

    return newSessionID
  })

  const revert = {
    stage: Effect.fn("V2Session.revert.stage")(function* (input: {
      sessionID: SessionSchema.ID
      messageID: SessionMessage.ID
      files?: boolean
    }) {
      const session = yield* result().get(input.sessionID)
      return yield* SessionRevert.stage({ session, messageID: input.messageID, files: input.files }).pipe(
        Effect.provideService(Database.Service, deps.database),
        Effect.provideService(EventV2.Service, deps.events),
        Effect.provide(deps.locations.get(session.location)),
      )
    }),
    clear: Effect.fn("V2Session.revert.clear")(function* (sessionID: SessionSchema.ID) {
      const session = yield* result().get(sessionID)
      yield* SessionRevert.clear(session).pipe(
        Effect.provideService(EventV2.Service, deps.events),
        Effect.provide(deps.locations.get(session.location)),
      )
    }),
    commit: Effect.fn("V2Session.revert.commit")(function* (sessionID: SessionSchema.ID) {
      const session = yield* result().get(sessionID)
      yield* SessionRevert.commit(session).pipe(Effect.provideService(EventV2.Service, deps.events))
    }),
  }

  return { create, fork, revert }
}