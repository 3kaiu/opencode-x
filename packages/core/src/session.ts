export * as SessionV2 from "./session"
export * from "./session/schema"

import { Effect, Layer, Option, Schema, Context, Stream, Scope } from "effect"
import { Observability } from "@opencode-ai/observability"
import { ListAnchor } from "@opencode-ai/schema/session"
import { ProjectV2 } from "./project"
import { WorkspaceV2 } from "./workspace"
import { ModelV2 } from "./model"
import { AbsolutePath, PositiveInt, RelativePath } from "./schema"
import { Revert } from "@opencode-ai/schema/revert"
import { SessionRunner } from "./session/runner/index"
import { SessionStore } from "./session/store"
import { SessionExecution } from "./session/execution"
import { makeGlobalNode } from "./effect/app-node"
import { LocationServiceMap } from "./location-service-map"
import { SessionEvent } from "./session/event"
import { SessionInput } from "./session/input"
import { Snapshot } from "./snapshot"
import { KeyedMutex } from "./effect/keyed-mutex"
import { AppProcess } from "./process"
import { SessionTodo } from "./session/todo"
import { SessionProjector } from "./session/projector"
import { Database } from "./database/database"
import { EventV2 } from "./event"
import { SessionMessage } from "./session/message"
import { Prompt } from "./session/prompt"
import { PromptInput } from "@opencode-ai/schema/prompt-input"
import { SessionMessageTable } from "./session/sql"
import { SessionSchema } from "./session/schema"
import { MessageDecodeError } from "./session/error"
import { NotFoundError, OperationUnavailableError, PromptConflictError, SkillNotFoundError } from "./session/errors"
import type { MessageNotFoundError } from "./session/errors"
import { makeQueryMethods, type QueryDependencies } from "./session/query"
import {
  makeLifecycleMethods,
  type CreateInput,
  type LifecycleDependencies,
} from "./session/lifecycle"
import { makeControlsMethods, type ControlsDependencies } from "./session/controls"

export const RevertState = Revert.State
export type RevertState = Revert.State

export { ListAnchor }

const ListInputBase = {
  workspaceID: WorkspaceV2.ID.pipe(Schema.optional),
  search: Schema.String.pipe(Schema.optional),
  limit: PositiveInt.pipe(Schema.optional),
  order: Schema.Literals(["asc", "desc"]).pipe(Schema.optional),
  anchor: ListAnchor.pipe(Schema.optional),
}

const ListDirectoryInput = Schema.Struct({
  ...ListInputBase,
  directory: AbsolutePath,
})

const ListProjectInput = Schema.Struct({
  ...ListInputBase,
  project: ProjectV2.ID,
  subpath: RelativePath.pipe(Schema.optional),
})

const ListAllInput = Schema.Struct(ListInputBase)

export const ListInput = Schema.Union([ListDirectoryInput, ListProjectInput, ListAllInput])
export type ListInput = typeof ListInput.Type

type CompactInput = {
  sessionID: SessionSchema.ID
  prompt?: Prompt
}

export { NotFoundError, OperationUnavailableError, PromptConflictError, SkillNotFoundError } from "./session/errors"
export { ContextSnapshotDecodeError, MessageDecodeError } from "./session/error"
export { MessageNotFoundError } from "./session/errors"
export type { Error } from "./session/errors"

export interface Interface {
  readonly list: (input?: ListInput) => Effect.Effect<SessionSchema.Info[]>
  readonly create: (input: CreateInput) => Effect.Effect<SessionSchema.Info>
  readonly get: (sessionID: SessionSchema.ID) => Effect.Effect<SessionSchema.Info, NotFoundError>
  readonly remove: (sessionID: SessionSchema.ID) => Effect.Effect<void, NotFoundError>
  readonly update: (input: {
    sessionID: SessionSchema.ID
    title?: string
    metadata?: Record<string, unknown>
    archived?: number | null
  }) => Effect.Effect<SessionSchema.Info, NotFoundError>
  readonly children: (sessionID: SessionSchema.ID) => Effect.Effect<SessionSchema.Info[], NotFoundError>
  readonly todo: (sessionID: SessionSchema.ID) => Effect.Effect<ReadonlyArray<SessionTodo.Info>, NotFoundError>
  readonly messages: (input: {
    sessionID: SessionSchema.ID
    limit?: number
    order?: "asc" | "desc"
    cursor?: {
      id: SessionMessage.ID
      direction: "previous" | "next"
    }
  }) => Effect.Effect<SessionMessage.Message[], NotFoundError | MessageDecodeError>
  readonly message: (input: {
    sessionID: SessionSchema.ID
    messageID: SessionMessage.ID
  }) => Effect.Effect<SessionMessage.Message | undefined>
  readonly context: (
    sessionID: SessionSchema.ID,
  ) => Effect.Effect<SessionMessage.Message[], NotFoundError | MessageDecodeError>
  readonly events: (input: {
    sessionID: SessionSchema.ID
    after?: number
  }) => Stream.Stream<SessionEvent.DurableEvent, NotFoundError>
  readonly history: (input: {
    sessionID: SessionSchema.ID
    after?: number
    limit: number
  }) => Effect.Effect<{ events: ReadonlyArray<SessionEvent.DurableEvent>; hasMore: boolean }, NotFoundError>
  readonly switchAgent: (input: { sessionID: SessionSchema.ID; agent: string }) => Effect.Effect<void, NotFoundError>
  readonly switchModel: (input: {
    sessionID: SessionSchema.ID
    model: ModelV2.Ref
  }) => Effect.Effect<void, NotFoundError>
  readonly prompt: (input: {
    id?: SessionMessage.ID
    sessionID: SessionSchema.ID
    prompt: PromptInput.Prompt
    delivery?: SessionInput.Delivery
    resume?: boolean
  }) => Effect.Effect<SessionInput.Admitted, NotFoundError | PromptConflictError>
  readonly shell: (input: {
    id?: EventV2.ID
    sessionID: SessionSchema.ID
    command: string
  }) => Effect.Effect<void, NotFoundError>
  readonly skill: (input: {
    id?: SessionMessage.ID
    sessionID: SessionSchema.ID
    skill: string
    resume?: boolean
  }) => Effect.Effect<void, NotFoundError | SkillNotFoundError>
  readonly compact: (input: CompactInput) => Effect.Effect<void, NotFoundError | OperationUnavailableError>
  readonly wait: (id: SessionSchema.ID) => Effect.Effect<void, NotFoundError>
  readonly active: Effect.Effect<ReadonlySet<SessionSchema.ID>>
  readonly resume: (sessionID: SessionSchema.ID) => Effect.Effect<void, NotFoundError | SessionRunner.RunError>
  readonly interrupt: (sessionID: SessionSchema.ID) => Effect.Effect<void>
  readonly fork: (input: {
    sessionID: SessionSchema.ID
    atSeq?: number
    atMessageID?: SessionMessage.ID
  }) => Effect.Effect<SessionSchema.ID, NotFoundError>
  readonly revert: {
    readonly stage: (input: {
      sessionID: SessionSchema.ID
      messageID: SessionMessage.ID
      files?: boolean
    }) => Effect.Effect<Revert.State, NotFoundError | MessageNotFoundError | Snapshot.Error>
    readonly clear: (sessionID: SessionSchema.ID) => Effect.Effect<void, NotFoundError | Snapshot.Error>
    readonly commit: (sessionID: SessionSchema.ID) => Effect.Effect<void, NotFoundError>
  }
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/Session") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const database = yield* Database.Service
    const db = database.db
    const events = yield* EventV2.Service
    const projects = yield* ProjectV2.Service
    const execution = yield* SessionExecution.Service
    const store = yield* SessionStore.Service
    const locations = yield* LocationServiceMap.Service
    const appProcess = yield* AppProcess.Service
    const scope = yield* Scope.Scope
    const observability = Option.getOrUndefined(yield* Effect.serviceOption(Observability))
    const activeShells = new Set<SessionSchema.ID>()
    const pendingResume = new Set<SessionSchema.ID>()
    const shellLocks = KeyedMutex.makeUnsafe<SessionSchema.ID>()
    const decodeMessage = Schema.decodeUnknownEffect(SessionMessage.Message)
    const isDurableSessionEvent = Schema.is(SessionEvent.Durable)
    const decode = (row: typeof SessionMessageTable.$inferSelect) =>
      decodeMessage({ ...row.data, id: row.id, type: row.type }).pipe(
        Effect.mapError(
          () =>
            new MessageDecodeError({
              sessionID: SessionSchema.ID.make(row.session_id),
              messageID: SessionMessage.ID.make(row.id),
            }),
        ),
      )

    const queryDeps: QueryDependencies = {
      db,
      store,
      events,
      execution,
      locations,
      isDurableSessionEvent,
      decode,
      getResult: () => result,
    }
    const lifecycleDeps: LifecycleDependencies = {
      db,
      database,
      store,
      events,
      locations,
      projects,
      getResult: () => result,
    }
    const controlsDeps: ControlsDependencies = {
      db,
      events,
      execution,
      locations,
      appProcess,
      scope,
      observability,
      activeShells,
      pendingResume,
      shellLocks,
      getResult: () => result,
    }

    const result = Service.of({
      ...makeQueryMethods(queryDeps),
      ...makeLifecycleMethods(lifecycleDeps),
      ...makeControlsMethods(controlsDeps),
    })

    return result
  }),
)

export const node = makeGlobalNode({
  service: Service,
  layer: layer.pipe(Layer.orDie),
  deps: [
    Database.node,
    EventV2.node,
    ProjectV2.node,
    SessionExecution.node,
    SessionStore.node,
    LocationServiceMap.node,
    SessionProjector.node,
    AppProcess.node,
  ],
})