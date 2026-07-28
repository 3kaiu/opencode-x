import { afterEach, describe, expect } from "bun:test"
import { NodeHttpServer, NodeServices } from "@effect/platform-node"
import { Config, Effect, Exit, Layer } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse, HttpRouter, HttpServer } from "effect/unstable/http"
import { layerWebSocketConstructorGlobal } from "effect/unstable/socket/Socket"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Ripgrep } from "@opencode-ai/core/ripgrep"
import { Database } from "@opencode-ai/core/database/database"
import { EventTable } from "@opencode-ai/core/event/sql"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { asc, eq } from "drizzle-orm"
import { InstanceBootstrap as InstanceBootstrapService } from "../../src/project/bootstrap-service"
import { InstanceStore } from "../../src/project/instance-store"
import { Project } from "../../src/project/project"
import { Workspace } from "../../src/control-plane/workspace"
import { HttpApiApp } from "../../src/server/routes/instance/httpapi/server"
import { SessionPaths } from "../../src/server/routes/instance/httpapi/groups/session"
import { Session } from "@/session/session"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances, provideInstanceEffect, tmpdirScoped } from "../fixture/fixture"
import { TestLLMServer } from "../lib/llm-server"
import { testProviderConfig } from "../lib/test-provider"
import { pollWithTimeout, testEffect } from "../lib/effect"

// Shadow parity harness: drive the same prompt through the v1 write path
// (POST /session/:id/message -> SessionPrompt.loop) and the v2 write path
// (POST /api/session/:id/prompt -> SessionV2.prompt -> wake -> SessionRunner)
// against one production HTTP stack and one TestLLMServer, then compare the
// durable artifacts each path leaves behind. Divergences documented here feed
// the v2 write-path gap list.

const noopBootstrapLayer = Layer.succeed(
  InstanceBootstrapService.Service,
  InstanceBootstrapService.Service.of({ run: Effect.void }),
)
const appLayer = AppNodeBuilder.build(
  LayerNode.group([InstanceStore.node, Project.node, Session.node, Workspace.node, Database.node, Ripgrep.node]),
  [[InstanceStore.bootstrapNode, noopBootstrapLayer]],
)
const servedRoutes: Layer.Layer<never, Config.ConfigError, HttpServer.HttpServer> = HttpRouter.serve(
  HttpApiApp.routes,
  {
    disableListenLog: true,
    disableLogger: true,
  },
)
const httpApiLayer = servedRoutes.pipe(
  Layer.provide(layerWebSocketConstructorGlobal),
  Layer.provideMerge(NodeHttpServer.layerTest),
  Layer.provideMerge(NodeServices.layer),
)
const it = testEffect(Layer.mergeAll(appLayer, httpApiLayer))

function pathFor(path: string, params: Record<string, string>) {
  return Object.entries(params).reduce((result, [key, value]) => result.replace(`:${key}`, value), path)
}

function request(path: string, init?: RequestInit) {
  const url = new URL(path, "http://localhost")
  return HttpClientRequest.fromWeb(new Request(url, init)).pipe(
    HttpClientRequest.setUrl(url.pathname),
    HttpClient.execute,
  )
}

function json<T>(response: HttpClientResponse.HttpClientResponse) {
  if (response.status !== 200) return response.text.pipe(Effect.flatMap((text) => Effect.die(new Error(text))))
  return response.json.pipe(Effect.map((value) => value as T))
}

function requestJson<T>(path: string, init?: RequestInit) {
  return request(path, init).pipe(Effect.flatMap(json<T>))
}

const sessionEvents = (sessionID: string) =>
  Database.Service.use(({ db }) =>
    db
      .select({ type: EventTable.type })
      .from(EventTable)
      .where(eq(EventTable.aggregate_id, sessionID))
      .orderBy(asc(EventTable.seq))
      .all()
      .pipe(
        Effect.orDie,
        Effect.map((rows) => rows.map((row) => row.type)),
      ),
  )

afterEach(async () => {
  await disposeAllInstances()
  await resetDatabase()
})

describe("session shadow parity", () => {
  it.live("same prompt through v1 and v2 write paths", () =>
    Effect.gen(function* () {
      const llm = yield* TestLLMServer
      const config = testProviderConfig(llm.url)
      const dir = yield* tmpdirScoped({ git: true, config })
      const headers = { "x-opencode-directory": dir }
      const model = { providerID: ProviderV2.ID.make("test"), id: ModelV2.ID.make("test-model") }

      // --- v1 leg: synchronous loop through POST /session/:id/message
      const v1Session = yield* Session.use.create({ title: "shadow v1" }).pipe(provideInstanceEffect(dir))
      yield* llm.text("world", { usage: { input: 7, output: 3 } })
      const v1Response = yield* request(pathFor(SessionPaths.prompt, { sessionID: v1Session.id }), {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({
          agent: "build",
          model: { providerID: "test", modelID: "test-model" },
          parts: [{ type: "text", text: "hello shadow" }],
        }),
      })
      expect(v1Response.status).toBe(200)
      const v1HitCount = (yield* llm.hits).length
      const v1Messages = yield* requestJson<SessionV1.WithParts[]>(
        pathFor(SessionPaths.messages, { sessionID: v1Session.id }),
        { headers },
      )
      const v1Projected = yield* requestJson<{ data: SessionMessage.Message[] }>(
        `/api/session/${v1Session.id}/message?order=asc`,
        { headers },
      )
      const v1Events = yield* sessionEvents(v1Session.id)

      // --- v2 leg: durable admit + advisory wake through POST /api/session/:id/prompt
      const v2Session = yield* Session.use
        .create({ title: "shadow v2", agent: "build", model })
        .pipe(provideInstanceEffect(dir))
      yield* llm.text("world", { usage: { input: 7, output: 3 } })
      const v2Response = yield* request(`/api/session/${v2Session.id}/prompt`, {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({ prompt: { text: "hello shadow" } }),
      })
      expect(v2Response.status).toBe(200)

      const v2Assistant = yield* pollWithTimeout(
        requestJson<{ data: SessionMessage.Message[] }>(`/api/session/${v2Session.id}/message?order=asc`, {
          headers,
        }).pipe(Effect.map(({ data }) => data.find((message) => message.type === "assistant"))),
        "v2 write path never produced an assistant message",
        "15 seconds",
      ).pipe(Effect.exit)

      const v2Projected = yield* requestJson<{ data: SessionMessage.Message[] }>(
        `/api/session/${v2Session.id}/message?order=asc`,
        { headers },
      )
      const v2Events = yield* sessionEvents(v2Session.id)
      const v2HitCount = (yield* llm.hits).length - v1HitCount

      // Parity: both paths make exactly one provider call for one prompt.
      expect(v1HitCount).toBe(1)
      expect(v2HitCount).toBe(1)

      // v1 leg produces a user + assistant transcript with the mocked reply.
      expect(v1Messages.map((message) => message.info.role)).toEqual(["user", "assistant"])
      const v1Text = v1Messages[1]!.parts.find((part) => part.type === "text")
      expect(v1Text).toMatchObject({ type: "text", text: "world" })

      // v1 writes bridge the user turn into the v2 read projection; the
      // assistant turn stays v1-owned until the v2 runner takes over execution.
      expect(v1Projected.data.map((message) => message.type)).toEqual(["user"])

      // v2 leg reaches the same assistant reply, finish reason, and usage.
      expect(Exit.isSuccess(v2Assistant)).toBe(true)
      if (Exit.isSuccess(v2Assistant)) {
        expect(v2Assistant.value).toMatchObject({
          type: "assistant",
          agent: "build",
          model: { providerID: "test", id: "test-model" },
          content: [{ type: "text", text: "world" }],
          finish: "stop",
          tokens: { input: 7, output: 3 },
        })
      }
      expect(v2Projected.data.map((message) => message.type)).toEqual(["user", "assistant"])

      // Event vocabularies still diverge for the assistant turn: v1 bridges
      // only the user prompt into session.next.*; v2 owns the full sequence.
      expect(v1Events.filter((type) => type.startsWith("session.next."))).toEqual(["session.next.prompted.1"])
      expect(v2Events).toEqual([
        "session.created.1",
        "session.next.prompt.admitted.1",
        "session.next.prompted.1",
        "session.next.step.started.1",
        "session.next.text.started.1",
        "session.next.text.ended.1",
        "session.next.step.ended.2",
      ])
    }).pipe(Effect.provide(TestLLMServer.layer), Effect.provide(AppNodeBuilder.build(CrossSpawnSpawner.node))),
    120_000,
  )
})
