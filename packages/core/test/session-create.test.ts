import { describe, expect } from "bun:test"
import path from "path"
import { Effect, Layer, Stream, DateTime } from "effect"
import { Agent } from "@opencode-ai/core/agent"
import { asc, eq } from "drizzle-orm"
import { Database } from "@opencode-ai/core/database/database"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Event } from "@opencode-ai/core/event"
import { EventTable } from "@opencode-ai/core/event/sql"
import { Location } from "@opencode-ai/core/location"
import { Model } from "@opencode-ai/core/model"
import { Project } from "@opencode-ai/core/project"
import { ProjectTable } from "@opencode-ai/core/project/sql"
import { Provider } from "@opencode-ai/core/provider"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { Session } from "@opencode-ai/core/session"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { Prompt } from "@opencode-ai/core/session/prompt"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { SessionExecution } from "@opencode-ai/core/session/execution"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { SessionInput } from "@opencode-ai/core/session/input"
import { SessionEvent } from "@opencode-ai/core/session/event"
import { SessionTable } from "@opencode-ai/core/session/sql"
import { SessionMessageTable } from "@opencode-ai/core/session/sql"
import { SessionStore } from "@opencode-ai/core/session/store"
import { Skill } from "@opencode-ai/core/skill"
import { LocationServiceMap } from "@opencode-ai/core/location-service-map"
import { Workspace } from "@opencode-ai/core/workspace"
import { testEffect } from "./lib/effect"
import { tmpdir } from "./fixture/tmpdir"

const projects = Layer.succeed(
  Project.Service,
  Project.Service.of({
    resolve: (directory) => Effect.succeed({ id: Project.ID.global, directory }),
    directories: () => Effect.succeed([]),
    commit: () => Effect.void,
  }),
)
const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([
      Database.node,
      Event.node,
      LocationServiceMap.node,
      SessionProjector.node,
      SessionStore.node,
      Session.node,
    ]),
    [
      [Project.node, projects],
      [SessionExecution.node, SessionExecution.noopLayer],
    ],
  ),
)
const location = Location.Ref.make({ directory: AbsolutePath.make("/project") })
const id = Session.ID.create()

describe("Session.create", () => {
  it.effect("creates a fresh projected session when the ID is omitted", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service

      const first = yield* session.create({ location })
      const second = yield* session.create({ location })

      expect(second.id).not.toBe(first.id)
      expect(yield* session.list()).toHaveLength(2)
    }),
  )

  it.effect("returns the original session when the ID is retried", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const input = { id, location }

      const first = yield* session.create(input)
      const retried = yield* session.create(input)

      expect(retried).toEqual(first)
      expect(yield* session.list()).toEqual([first])
    }),
  )

  it.effect("stores supplied immutable create attributes", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const workspaceID = Workspace.ID.make("wrk_test")
      const model = Model.Ref.make({
        id: Model.ID.make("sonnet"),
        providerID: Provider.ID.anthropic,
        variant: Model.VariantID.make("fast"),
      })

      expect(
        yield* session.create({
          location: Location.Ref.make({ directory: location.directory, workspaceID }),
          agent: Agent.ID.make("build"),
          model,
        }),
      ).toMatchObject({ location: { directory: location.directory, workspaceID }, agent: "build", model })
    }),
  )

  it.effect("returns the existing Session when one ID is reused with different create arguments", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const created = yield* session.create({ id, location })
      const changed = [
        { id, location: Location.Ref.make({ directory: AbsolutePath.make("/other") }) },
        { id, location, agent: Agent.ID.make("build") },
        {
          id,
          location,
          model: Model.Ref.make({ id: Model.ID.make("sonnet"), providerID: Provider.ID.anthropic }),
        },
      ]

      for (const input of changed) {
        expect(yield* session.create(input)).toEqual(created)
      }
      expect(yield* session.list()).toHaveLength(1)
    }),
  )

  it.effect("returns one recorded session to concurrent exact retries", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const input = { id, location }

      const created = yield* Effect.all([session.create(input), session.create(input)], { concurrency: "unbounded" })

      expect(created[1]).toEqual(created[0])
      expect(yield* session.list()).toEqual([created[0]])
    }),
  )

  it.effect("returns the current Session projection after updates", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const { db } = yield* Database.Service
      const input = { id, location }
      const created = yield* session.create(input)

      yield* db.update(SessionTable).set({ agent: "build" }).where(eq(SessionTable.id, id)).run().pipe(Effect.orDie)

      expect(yield* session.create(input)).toMatchObject({ id: created.id, agent: "build" })
    }),
  )

  it.effect("returns the current Session projection after projected updates", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const events = yield* Event.Service
      const input = { id, location }
      const created = yield* session.create(input)

      yield* events.publish(SessionV1.Event.Updated, {
        sessionID: id,
        info: SessionV1.SessionInfo.make({
          id,
          slug: "updated",
          version: "test",
          projectID: created.projectID,
          directory: created.location.directory,
          title: "updated",
          agent: "build",
          time: { created: 0, updated: 1 },
        }),
      })

      expect(yield* session.create(input)).toMatchObject({ id, agent: "build" })
    }),
  )

  it.effect("persists creation through the existing legacy created event", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const { db } = yield* Database.Service
      const created = yield* session.create({ location })

      expect(
        yield* db.select().from(EventTable).where(eq(EventTable.aggregate_id, created.id)).all().pipe(Effect.orDie),
      ).toMatchObject([{ type: Event.versionedType(SessionV1.Event.Created.type, 1) }])
    }),
  )

  it.effect("persists caller-ID creation through the existing created event", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const { db } = yield* Database.Service
      const created = yield* session.create({ id, location })

      expect(
        yield* db.select().from(EventTable).where(eq(EventTable.aggregate_id, created.id)).get().pipe(Effect.orDie),
      ).toMatchObject({
        data: { sessionID: id },
      })
    }),
  )

  it.effect("omits legacy creation rows from the V2 Session event stream", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const events = yield* Event.Service
      const { db } = yield* Database.Service
      const created = yield* session.create({ location })
      yield* session.prompt({ sessionID: created.id, prompt: Prompt.make({ text: "Hello" }), resume: false })
      yield* SessionInput.promoteSteers(db, events, created.id, Number.MAX_SAFE_INTEGER)

      expect(
        Array.from(yield* session.events({ sessionID: created.id }).pipe(Stream.take(2), Stream.runCollect)),
      ).toMatchObject([
        { durable: { seq: 1 }, type: "session.next.prompt.admitted", data: { prompt: { text: "Hello" } } },
        { durable: { seq: 2 }, type: "session.next.prompted" },
      ])
    }),
  )

  it.effect("replays one prompt lifecycle into a fresh target database", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const sourceEvents = yield* Event.Service
      const sourceDb = (yield* Database.Service).db
      const created = yield* session.create({ id: Session.ID.make("ses_fresh_target_replay"), location })
      const admitted = yield* session.prompt({
        sessionID: created.id,
        prompt: Prompt.make({ text: "Replay lifecycle" }),
        resume: false,
      })
      yield* SessionInput.promoteSteers(sourceDb, sourceEvents, created.id, Number.MAX_SAFE_INTEGER)
      const serialized = (yield* sourceDb
        .select()
        .from(EventTable)
        .where(eq(EventTable.aggregate_id, created.id))
        .orderBy(asc(EventTable.seq))
        .all()
        .pipe(Effect.orDie)).map((event) => ({
        id: event.id,
        aggregateID: event.aggregate_id,
        seq: event.seq,
        type: event.type,
        data: event.data,
      }))

      const tmp = yield* Effect.acquireRelease(
        Effect.promise(() => tmpdir()),
        (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
      )
      const targetDatabase = Database.layerFromPath(path.join(tmp.path, "target.sqlite"))
      const targetLayer = AppNodeBuilder.build(
        LayerNode.group([Database.node, Event.node, SessionProjector.node, SessionStore.node]),
        [[Database.node, targetDatabase]],
      )

      yield* Effect.gen(function* () {
        const db = (yield* Database.Service).db
        const events = yield* Event.Service
        const store = yield* SessionStore.Service
        yield* db
          .insert(ProjectTable)
          .values({ id: Project.ID.global, worktree: location.directory, sandboxes: [] })
          .run()
          .pipe(Effect.orDie)

        expect(yield* store.get(created.id)).toBeUndefined()
        expect(yield* events.replayAll(serialized.slice(0, 2))).toBe(created.id)
        expect(yield* SessionInput.find(db, admitted.id)).toMatchObject({
          id: admitted.id,
          sessionID: created.id,
          prompt: { text: "Replay lifecycle" },
          delivery: "steer",
          admittedSeq: 1,
        })
        expect(yield* store.context(created.id)).toEqual([])

        expect(yield* events.replayAll(serialized.slice(2))).toBe(created.id)
        expect(yield* SessionInput.find(db, admitted.id)).toMatchObject({
          id: admitted.id,
          sessionID: created.id,
          prompt: { text: "Replay lifecycle" },
          delivery: "steer",
          admittedSeq: 1,
          promotedSeq: 2,
        })
        expect(yield* store.context(created.id)).toMatchObject([
          { id: admitted.id, type: "user", text: "Replay lifecycle" },
        ])
        expect(
          (yield* db
            .select()
            .from(EventTable)
            .where(eq(EventTable.aggregate_id, created.id))
            .orderBy(asc(EventTable.seq))
            .all()
            .pipe(Effect.orDie)).map((event) => [event.seq, event.type]),
        ).toEqual([
          [0, Event.versionedType(SessionV1.Event.Created.type, 1)],
          [1, Event.versionedType(SessionEvent.PromptAdmitted.type, 1)],
          [2, Event.versionedType(SessionEvent.Prompted.type, 1)],
        ])
      }).pipe(Effect.provide(Layer.fresh(targetLayer)))
    }),
  )

  it.effect("does not mask unrelated created projector defects", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const event = yield* Event.Service
      const defect = new Error("unrelated projector defect")
      yield* event.project(SessionV1.Event.Created, () => Effect.die(defect))

      expect(yield* session.create({ id, location }).pipe(Effect.catchDefect(Effect.succeed))).toBe(defect)
    }),
  )

  it.live("runs a shell command as a durable shell message", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const tmp = yield* Effect.acquireRelease(
        Effect.promise(() => tmpdir()),
        (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
      )
      const created = yield* session.create({
        location: Location.Ref.make({ directory: AbsolutePath.make(tmp.path) }),
      })

      yield* session.shell({ sessionID: created.id, command: "echo hello" })

      const messages = yield* session.messages({ sessionID: created.id, order: "asc" })
      expect(messages).toMatchObject([{ type: "shell", command: "echo hello", output: "hello\n" }])
      expect(messages[0]?.type === "shell" && messages[0].time.completed !== undefined).toBe(true)
    }),
  )

  it.live("records nonzero exits and empty output as a completed shell message", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const tmp = yield* Effect.acquireRelease(
        Effect.promise(() => tmpdir()),
        (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
      )
      const created = yield* session.create({
        location: Location.Ref.make({ directory: AbsolutePath.make(tmp.path) }),
      })

      yield* session.shell({ sessionID: created.id, command: "exit 7" })

      expect(yield* session.messages({ sessionID: created.id, order: "asc" })).toMatchObject([
        { type: "shell", command: "exit 7", output: "(no output)" },
      ])
    }),
  )

  it.effect("rejects a shell command for a missing Session", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const missing = Session.ID.make("ses_missing_shell")

      expect(
        yield* session.shell({ sessionID: missing, command: "pwd" }).pipe(
          Effect.flip,
          Effect.map((error) => error._tag),
        ),
      ).toBe("Session.NotFoundError")
    }),
  )

  it.effect("activates a known skill as a durable skill message", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const tmp = yield* Effect.acquireRelease(
        Effect.promise(() => tmpdir()),
        (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
      )
      const created = yield* session.create({
        location: Location.Ref.make({ directory: AbsolutePath.make(tmp.path) }),
      })
      const skills = yield* Skill.Service.pipe(Effect.provide(LocationServiceMap.Service.get(created.location)))
      yield* skills.transform((editor) =>
        editor.source({
          type: "embedded",
          skill: Skill.Info.make({
            name: "review",
            location: AbsolutePath.make(path.join(tmp.path, "review/SKILL.md")),
            content: "Review the changes carefully.",
          }),
        }),
      )

      yield* session.skill({ sessionID: created.id, skill: "review" })

      expect(yield* session.messages({ sessionID: created.id, order: "asc" })).toMatchObject([
        { type: "skill", name: "review", text: "Review the changes carefully." },
      ])
      expect(yield* session.skill({ sessionID: created.id, skill: "missing" }).pipe(Effect.flip)).toMatchObject({
        _tag: "Session.SkillNotFoundError",
        skill: "missing",
      })
    }),
  )

  it.effect("switches the selected agent through the durable Session event", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const created = yield* session.create({ location })

      yield* session.switchAgent({ sessionID: created.id, agent: "plan" })

      expect(yield* session.get(created.id)).toMatchObject({ agent: "plan" })
      expect(
        Array.from(yield* session.events({ sessionID: created.id }).pipe(Stream.take(1), Stream.runCollect)),
      ).toMatchObject([{ type: "session.next.agent.switched", data: { agent: "plan" } }])
    }),
  )

  it.effect("rejects an agent switch for a missing Session", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const missing = Session.ID.make("ses_missing_agent_switch")

      expect(
        yield* session.switchAgent({ sessionID: missing, agent: "plan" }).pipe(
          Effect.flip,
          Effect.map((error) => error._tag),
        ),
      ).toBe("Session.NotFoundError")
    }),
  )

  it.effect("switches the selected model through the durable Session event", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const created = yield* session.create({ location })
      const model = Model.Ref.make({
        id: Model.ID.make("sonnet"),
        providerID: Provider.ID.anthropic,
        variant: Model.VariantID.make("high"),
      })

      yield* session.switchModel({ sessionID: created.id, model })

      expect(yield* session.get(created.id)).toMatchObject({ model })
      expect(
        Array.from(yield* session.events({ sessionID: created.id }).pipe(Stream.take(1), Stream.runCollect)),
      ).toMatchObject([{ type: "session.next.model.switched", data: { model } }])
    }),
  )

  it.effect("ignores a model switch when the selected model is unchanged", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const created = yield* session.create({ location })
      const model = Model.Ref.make({ id: Model.ID.make("sonnet"), providerID: Provider.ID.anthropic })

      yield* session.switchModel({ sessionID: created.id, model })
      yield* session.switchModel({ sessionID: created.id, model })

      const { db } = yield* Database.Service
      expect(
        yield* db.select().from(EventTable).where(eq(EventTable.aggregate_id, created.id)).all().pipe(Effect.orDie),
      ).toHaveLength(2)
      expect(yield* session.get(created.id)).toMatchObject({ model })
    }),
  )

  it.effect("treats an omitted variant as the default variant", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const model = Model.Ref.make({ id: Model.ID.make("sonnet"), providerID: Provider.ID.anthropic })
      const created = yield* session.create({ location, model })

      yield* session.switchModel({
        sessionID: created.id,
        model: Model.Ref.make({ ...model, variant: Model.VariantID.make("default") }),
      })

      const { db } = yield* Database.Service
      expect(
        yield* db.select().from(EventTable).where(eq(EventTable.aggregate_id, created.id)).all().pipe(Effect.orDie),
      ).toHaveLength(1)
    }),
  )

  it.effect("rejects a model switch for a missing Session", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const missing = Session.ID.make("ses_missing_model_switch")

      expect(
        yield* session
          .switchModel({
            sessionID: missing,
            model: Model.Ref.make({ id: Model.ID.make("sonnet"), providerID: Provider.ID.anthropic }),
          })
          .pipe(
            Effect.flip,
            Effect.map((error) => error._tag),
          ),
      ).toBe("Session.NotFoundError")
    }),
  )

  it.effect("forks a session with fresh message IDs so copies do not collide on the primary key", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const tmp = yield* Effect.acquireRelease(
        Effect.promise(() => tmpdir()),
        (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
      )
      const source = yield* session.create({
        location: Location.Ref.make({ directory: AbsolutePath.make(tmp.path) }),
      })
      yield* session.shell({ sessionID: source.id, command: "echo hello" })

      const forked = yield* session.fork({ sessionID: source.id })

      expect(forked).not.toBe(source.id)
      const { db } = yield* Database.Service
      const sourceMessages = yield* db
        .select({ id: SessionMessageTable.id, data: SessionMessageTable.data })
        .from(SessionMessageTable)
        .where(eq(SessionMessageTable.session_id, source.id))
        .all()
        .pipe(Effect.orDie)
      const forkedMessages = yield* db
        .select({ id: SessionMessageTable.id, data: SessionMessageTable.data })
        .from(SessionMessageTable)
        .where(eq(SessionMessageTable.session_id, forked))
        .all()
        .pipe(Effect.orDie)
      expect(forkedMessages).toHaveLength(sourceMessages.length)
      expect(forkedMessages.map((m) => m.id)).not.toEqual(sourceMessages.map((m) => m.id))
      expect(forkedMessages.map((m) => m.data)).toEqual(sourceMessages.map((m) => m.data))
    }),
  )

  it.effect("forks a session and keeps the durable sequence ahead of the copied messages", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const events = yield* Event.Service
      const tmp = yield* Effect.acquireRelease(
        Effect.promise(() => tmpdir()),
        (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
      )
      const source = yield* session.create({
        location: Location.Ref.make({ directory: AbsolutePath.make(tmp.path) }),
      })
      yield* session.shell({ sessionID: source.id, command: "echo hello" })
      const forked = yield* session.fork({ sessionID: source.id })
      const { db } = yield* Database.Service
      const copied = yield* db
        .select()
        .from(SessionMessageTable)
        .where(eq(SessionMessageTable.session_id, forked))
        .all()
        .pipe(Effect.orDie)
      // The copied messages occupy sequences 1..n; the aggregate must continue at n+1.
      expect(yield* Event.latestSequence(db, forked)).toBe(copied.length)
      yield* events.publish(SessionEvent.Prompted, {
        sessionID: forked,
        messageID: SessionMessage.ID.create(),
        prompt: Prompt.make({ text: "continue the fork" }),
        delivery: "steer",
        timestamp: yield* DateTime.now,
      })
      expect(yield* Event.latestSequence(db, forked)).toBe(copied.length + 1)
    }),
  )
})
