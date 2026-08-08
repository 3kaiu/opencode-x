import { describe, expect } from "bun:test"
import { DateTime, Effect } from "effect"
import { Database } from "@opencode-ai/core/database/database"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { EventV2 } from "@opencode-ai/core/event"
import { ModelV2 } from "@opencode-ai/core/model"
import { Project } from "@opencode-ai/core/project"
import { ProjectTable } from "@opencode-ai/core/project/sql"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionV2 } from "@opencode-ai/core/session"
import { SessionEvent } from "@opencode-ai/core/session/event"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { SessionTable } from "@opencode-ai/core/session/sql"
import { Memory } from "@opencode-ai/core/memory/store"
import { Retrospective } from "@opencode-ai/core/introspection/retrospective"
import { Global } from "@opencode-ai/core/global"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { testEffect } from "./lib/effect"
import path from "path"
import os from "os"

const testGlobal = Global.layerWith({ data: os.tmpdir() })
const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([Database.node, EventV2.node, Global.node]),
    [[Global.node, testGlobal]],
  ),
)
const timestamp = DateTime.makeUnsafe(1)
const model = { id: ModelV2.ID.make("model"), providerID: ProviderV2.ID.make("provider") }

const insertSession = (sessionID: SessionV2.ID) =>
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    yield* db
      .insert(ProjectTable)
      .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
      .onConflictDoNothing()
      .run()
      .pipe(Effect.orDie)
    yield* db
      .insert(SessionTable)
      .values({
        id: sessionID,
        project_id: Project.ID.global,
        slug: "retro",
        directory: "/project",
        title: "retro",
        version: "test",
      })
      .onConflictDoNothing()
      .run()
      .pipe(Effect.orDie)
  })

const toolCall = (sessionID: SessionV2.ID, callID: string, tool: string, input: Record<string, string>) =>
  Effect.gen(function* () {
    const service = yield* EventV2.Service
    const assistantMessageID = SessionMessage.ID.create()
    yield* service.publish(SessionEvent.Step.Started, {
      sessionID,
      assistantMessageID,
      timestamp,
      agent: "build",
      model,
    })
    yield* service.publish(SessionEvent.Tool.Called, {
      sessionID,
      timestamp,
      assistantMessageID,
      callID,
      tool,
      input,
      provider: { executed: false },
    })
    return assistantMessageID
  })

describe("Retrospective", () => {
  it.effect("rebuilds decision records from the durable tool stream", () =>
    Effect.gen(function* () {
      const sessionID = SessionV2.ID.make("ses_retro_records")
      yield* insertSession(sessionID)
      yield* toolCall(sessionID, "call-ok", "read", { path: "a.ts" })
      yield* toolCall(sessionID, "call-boom", "bash", { command: "pwd" })

      const service = yield* EventV2.Service
      const assistant = SessionMessage.ID.create()
      yield* service.publish(SessionEvent.Tool.Success, {
        sessionID,
        timestamp,
        assistantMessageID: assistant,
        callID: "call-ok",
        structured: {},
        content: [{ type: "text", text: "ok" }],
        provider: { executed: false },
      })
      yield* service.publish(SessionEvent.Tool.Failed, {
        sessionID,
        timestamp,
        assistantMessageID: assistant,
        callID: "call-boom",
        error: { type: "unknown", message: "not found: pwd" },
        provider: { executed: false },
      })

      const memory = yield* Effect.promise(() => Memory.openMemory(path.join(os.tmpdir(), "retro-records")))
      const result = yield* Retrospective.retrospect(sessionID, memory)

      expect(result.records).toHaveLength(2)
      expect(result.records[0]).toMatchObject({ action: { tool: "read" }, result: { outcome: "success" } })
      expect(result.records[1]).toMatchObject({ action: { tool: "bash" }, result: { outcome: "failure" } })
      expect(result.summary).toMatchObject({ total: 2, failures: 1 })
      expect(result.report).toContain("# Session Retro")
      expect(result.report).toContain("success rate: 50.0%")
      expect(result.report).toContain("- bash: 1")
      expect(result.lessonID).toBeTruthy()
    }),
  )

  it.effect("renders an empty retro for a session without tool decisions", () =>
    Effect.gen(function* () {
      const sessionID = SessionV2.ID.make("ses_retro_empty")
      yield* insertSession(sessionID)
      const memory = yield* Effect.promise(() => Memory.openMemory(path.join(os.tmpdir(), "retro-empty")))
      const result = yield* Retrospective.retrospect(sessionID, memory)

      expect(result.records).toHaveLength(0)
      expect(result.summary).toMatchObject({ total: 0, failures: 0, successRate: 1 })
      expect(result.report).toContain("No failures and no new skill candidates")
    }),
  )
})
