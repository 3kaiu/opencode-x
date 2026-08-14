import { WorkspaceID } from "@opencode-ai/schema/workspace-id"
import type { Target } from "@/control-plane/types"
import { Workspace } from "@/control-plane/workspace"
import { WorkspaceAdapterRuntime } from "@/control-plane/workspace-adapter-runtime"
import { SessionStore } from "@opencode-ai/core/session/store"
import { SessionSchema } from "@opencode-ai/core/session/schema"
import { getWorkspaceRouteSessionID, isLocalWorkspaceRoute } from "@/server/shared/workspace-routing"
import { Flag } from "@opencode-ai/core/flag/flag"
import { Context, Data, Effect, Layer, Option, Schema } from "effect"
import { HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { HttpApiMiddleware } from "effect/unstable/httpapi"
import { InvalidRequestError } from "../errors"

// Query fields this middleware reads from the URL. Spread into every
// endpoint query schema in groups that apply WorkspaceRoutingMiddleware,
// otherwise HttpApi rejects requests carrying these params with 400.
// HttpApiMiddleware in effect-smol cannot declare query params today —
// remove this once upstream supports middleware-declared query schemas.
export const WorkspaceRoutingQueryFields = {
  directory: Schema.optional(Schema.String),
  workspace: Schema.optional(Schema.String),
}

export const WorkspaceRoutingQuery = Schema.Struct(WorkspaceRoutingQueryFields)

type RequestPlan = Data.TaggedEnum<{
  InvalidWorkspace: {}
  MissingWorkspace: { readonly workspaceID: WorkspaceID }
  Local: { readonly directory: string; readonly workspaceID?: WorkspaceID }
}>
const RequestPlan = Data.taggedEnum<RequestPlan>()
const InvalidWorkspaceID = Symbol("InvalidWorkspaceID")

export class WorkspaceRouteContext extends Context.Service<
  WorkspaceRouteContext,
  {
    readonly directory: string
    readonly workspaceID?: WorkspaceID
  }
>()("@opencode/ExperimentalHttpApiWorkspaceRouteContext") {}

export class WorkspaceRoutingMiddleware extends HttpApiMiddleware.Service<
  WorkspaceRoutingMiddleware,
  {
    provides: WorkspaceRouteContext
    requires: SessionStore.Service
  }
>()("@opencode/ExperimentalHttpApiWorkspaceRouting") {}

function requestURL(request: HttpServerRequest.HttpServerRequest): URL {
  return new URL(request.url, "http://localhost")
}

function configuredWorkspaceID(): WorkspaceID | undefined {
  return Flag.OPENCODE_WORKSPACE_ID ? WorkspaceID.make(Flag.OPENCODE_WORKSPACE_ID) : undefined
}

function selectedWorkspaceID(url: URL, sessionWorkspaceID?: WorkspaceID): WorkspaceID | undefined {
  const workspaceParam = url.searchParams.get("workspace")
  return sessionWorkspaceID ?? (workspaceParam ? WorkspaceID.make(workspaceParam) : undefined)
}

function selectedV2WorkspaceID(
  url: URL,
  sessionWorkspaceID?: WorkspaceID,
): WorkspaceID | typeof InvalidWorkspaceID | undefined {
  if (sessionWorkspaceID) return sessionWorkspaceID
  const workspaceParam = url.searchParams.get("workspace")
  if (!workspaceParam) return undefined
  const workspaceID = Schema.decodeUnknownOption(WorkspaceID)(workspaceParam)
  if (Option.isNone(workspaceID)) return InvalidWorkspaceID
  return workspaceID.value
}

function defaultDirectory(request: HttpServerRequest.HttpServerRequest, url: URL): string {
  return url.searchParams.get("directory") || request.headers["x-opencode-directory"] || process.cwd()
}

function shouldStayOnControlPlane(request: HttpServerRequest.HttpServerRequest, url: URL): boolean {
  return isLocalWorkspaceRoute(request.method, url.pathname) || url.pathname.startsWith("/console")
}

function resolveWorkspace(
  id: WorkspaceID | undefined,
  envWorkspaceID: WorkspaceID | undefined,
): Effect.Effect<Workspace.Info | void, never, Workspace.Service> {
  if (!id || envWorkspaceID) return Effect.void
  return Workspace.Service.use((workspace) => workspace.get(id))
}

function missingWorkspaceResponse(id: WorkspaceID): HttpServerResponse.HttpServerResponse {
  return HttpServerResponse.text(`Workspace not found: ${id}`, {
    status: 500,
    contentType: "text/plain; charset=utf-8",
  })
}

function resolveTarget(workspace: Workspace.Info): Effect.Effect<Target> {
  return WorkspaceAdapterRuntime.target(workspace)
}

function planWorkspaceRequest(
  workspace: Workspace.Info,
): Effect.Effect<RequestPlan, never, Workspace.Service> {
  return Effect.gen(function* () {
    const target = yield* resolveTarget(workspace)
    return RequestPlan.Local({ directory: target.directory, workspaceID: workspace.id })
  })
}

function planRequest(
  request: HttpServerRequest.HttpServerRequest,
  session?: SessionSchema.Info,
): Effect.Effect<RequestPlan, never, Workspace.Service> {
  return Effect.gen(function* () {
    const url = requestURL(request)
    const envWorkspaceID = configuredWorkspaceID()
    const workspaceID = url.pathname.startsWith("/api/")
      ? selectedV2WorkspaceID(url, session?.location.workspaceID)
      : selectedWorkspaceID(url, session?.location.workspaceID)
    if (workspaceID === InvalidWorkspaceID) return RequestPlan.InvalidWorkspace()
    const workspace = yield* resolveWorkspace(workspaceID, envWorkspaceID)

    if (workspaceID && workspace === undefined && !envWorkspaceID) {
      return RequestPlan.MissingWorkspace({ workspaceID })
    }

    if (workspace !== undefined && !envWorkspaceID && !shouldStayOnControlPlane(request, url)) {
      return yield* planWorkspaceRequest(workspace)
    }

    return RequestPlan.Local({
      directory: session?.location.directory || defaultDirectory(request, url),
      workspaceID: envWorkspaceID ?? workspaceID,
    })
  })
}

function routeWorkspace<E>(
  effect: Effect.Effect<HttpServerResponse.HttpServerResponse, E, WorkspaceRouteContext>,
  plan: RequestPlan,
): Effect.Effect<HttpServerResponse.HttpServerResponse, E> {
  return RequestPlan.$match(plan, {
    InvalidWorkspace: () =>
      Effect.succeed(
        HttpServerResponse.jsonUnsafe(
          new InvalidRequestError({
            message: "Invalid workspace query parameter",
            kind: "Query",
            field: "workspace",
          }),
          { status: 400 },
        ),
      ),
    MissingWorkspace: ({ workspaceID }) => Effect.succeed(missingWorkspaceResponse(workspaceID)),
    Local: ({ directory, workspaceID }) =>
      effect.pipe(Effect.provideService(WorkspaceRouteContext, WorkspaceRouteContext.of({ directory, workspaceID }))),
  })
}

function routeHttpApiWorkspace<E>(
  effect: Effect.Effect<HttpServerResponse.HttpServerResponse, E, WorkspaceRouteContext>,
): Effect.Effect<HttpServerResponse.HttpServerResponse, E, SessionStore.Service | Workspace.Service | HttpServerRequest.HttpServerRequest> {
  return Effect.gen(function* () {
    const store = yield* SessionStore.Service
    const request = yield* HttpServerRequest.HttpServerRequest
    const sessionID = getWorkspaceRouteSessionID(requestURL(request))
    const session = sessionID ? yield* store.get(sessionID).pipe(Effect.catchDefect(() => Effect.succeed(undefined))) : undefined
    const plan = yield* planRequest(request, session)
    return yield* routeWorkspace(effect, plan)
  })
}

export const workspaceRoutingLayer = Layer.effect(
  WorkspaceRoutingMiddleware,
  Effect.gen(function* () {
    const workspace = yield* Workspace.Service
    return WorkspaceRoutingMiddleware.of((effect) =>
      routeHttpApiWorkspace(effect).pipe(Effect.provideService(Workspace.Service, workspace)),
    )
  }),
)
