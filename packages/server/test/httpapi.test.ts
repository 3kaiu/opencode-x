import { describe, expect, test } from "bun:test"
import { NodeHttpServer, NodeServices } from "@effect/platform-node"
import { EventV2 } from "@opencode-ai/core/event"
import { Location } from "@opencode-ai/core/location"
import type { LocationError, LocationServices } from "@opencode-ai/core/location-services"
import { LocationServiceMap } from "@opencode-ai/core/location-service-map"
import { PermissionSaved } from "@opencode-ai/core/permission/saved"
import { Project } from "@opencode-ai/core/project"
import { PtyTicket } from "@opencode-ai/core/pty/ticket"
import { QuestionV2 } from "@opencode-ai/core/question"
import { SessionV2 } from "@opencode-ai/core/session"
import { Authorization } from "@opencode-ai/protocol/middleware/authorization"
import { Effect, Layer, LayerMap } from "effect"
import { HttpClient, HttpClientRequest, HttpRouter, HttpServer } from "effect/unstable/http"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { layerWebSocketConstructorGlobal } from "effect/unstable/socket/Socket"
import { Api } from "../src/api"
import { handlers } from "../src/handlers"
import { layer as locationLayer } from "../src/location"
import { SessionLocationMiddleware } from "../src/middleware/session-location"
import { schemaErrorLayer } from "../src/middleware/schema-error"
import { SessionCommand } from "../src/session-command"
import { PtyEnvironment } from "../src/pty-environment"

// The location services map is only exercised for Location.Service in these
// tests; the remaining services of the LocationServices graph are never
// resolved, so a cast at the map boundary is safe (same pattern as
// core/test/effect/layer-node/node-build.test.ts).
const locationServiceMapStub = Layer.effect(
  LocationServiceMap.Service,
  // LayerMap.make returns an Effect that acquires the map, so it is handed to
  // Layer.effect directly (same shape as core's buildLocationServiceMap); the
  // cast only narrows the map's context to the full LocationServices graph.
  LayerMap.make(
    (ref: Location.Ref) =>
      Layer.succeed(
        Location.Service,
        Location.Service.of({
          directory: ref.directory,
          workspaceID: ref.workspaceID,
          project: { id: Project.ID.global, directory: ref.directory },
        }),
      ),
    { idleTimeToLive: "1 minute" },
  ) as unknown as Effect.Effect<LayerMap.LayerMap<Location.Ref, LocationServices, LocationError>>,
)

// The handler groups resolve these services when the routes are built, even
// though the endpoints under test never call them.
const routeStubs = Layer.mergeAll(
  Layer.mock(SessionV2.Service, { revert: { stage: () => Effect.never as never, clear: () => Effect.never as never, commit: () => Effect.never as never } }),
  Layer.mock(SessionCommand.Service, {}),
  Layer.mock(EventV2.Service, {}),
  Layer.mock(QuestionV2.Service, {}),
  Layer.mock(PtyTicket.Service, {}),
  Layer.mock(PtyEnvironment.Service, {}),
  Layer.mock(PermissionSaved.Service, {}),
)

const sessionLocationStub = Layer.succeed(
  SessionLocationMiddleware,
  SessionLocationMiddleware.of(
    ((effect: Effect.Effect<never, never, never>) => effect) as unknown as Parameters<
      typeof SessionLocationMiddleware.of
    >[0],
  ),
)

const authorizationStub = Layer.succeed(Authorization, Authorization.of((effect) => effect))

const routes = HttpApiBuilder.layer(Api).pipe(
  Layer.provide(handlers),
  Layer.provide(schemaErrorLayer),
  Layer.provide(locationLayer),
  Layer.provide(sessionLocationStub),
  Layer.provide(authorizationStub),
  Layer.provide(locationServiceMapStub),
  Layer.provide(routeStubs),
  HttpRouter.provideRequest(
    Layer.mock(PermissionSaved.Service, {
      list: () => Effect.succeed([]),
      add: () => Effect.void,
      remove: () => Effect.void,
    }),
  ),
)

const httpApiLayer = HttpRouter.serve(routes, {
  disableListenLog: true,
  disableLogger: true,
}).pipe(
  Layer.provideMerge(NodeHttpServer.layerTest),
  Layer.provideMerge(NodeServices.layer),
  Layer.provide(layerWebSocketConstructorGlobal),
)

function request(path: string, init?: RequestInit) {
  const headers = new Headers(init?.headers)
  headers.set("x-opencode-directory", "/tmp")
  const url = new URL(path, "http://localhost")
  return HttpClientRequest.fromWeb(new Request(url, { ...init, headers })).pipe(
    HttpClientRequest.setUrl(url.pathname),
    HttpClient.execute,
  )
}

const run = <A, E>(effect: Effect.Effect<A, E, never>) => Effect.runPromise(effect)

describe("server httpapi endpoints", () => {
  test("health.get returns healthy", () =>
    run(
      Effect.gen(function* () {
        const response = yield* request("/api/health")
        expect(response.status).toBe(200)
        expect(yield* response.json).toEqual({ healthy: true })
      }).pipe(Effect.provide(httpApiLayer)),
    ))

  test("location.get echoes the requested directory", () =>
    run(
      Effect.gen(function* () {
        const response = yield* request("/api/location")
        expect(response.status).toBe(200)
        const body = (yield* response.json) as { directory: string }
        expect(body.directory).toBe("/tmp")
      }).pipe(Effect.provide(httpApiLayer)),
    ))

  test("unknown endpoint returns 404", () =>
    run(
      Effect.gen(function* () {
        const response = yield* request("/api/does-not-exist")
        expect(response.status).toBe(404)
      }).pipe(Effect.provide(httpApiLayer)),
    ))
})