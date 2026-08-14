export * as McpConnect from "./connect"

import path from "node:path"
import { pathToFileURL } from "node:url"
import { InstallationVersion } from "@opencode-ai/core/installation/version"
import { ConfigMCP } from "@opencode-ai/core/config/mcp"
import { Event } from "@opencode-ai/core/event"
import { Client, type ClientOptions } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js"
import { ListRootsRequestSchema, type Tool as MCPToolDef } from "@modelcontextprotocol/sdk/types.js"
import { Cause, Effect, Exit, Schema } from "effect"
import { withTimeout } from "@/util/timeout"
import { TuiEvent } from "@/server/tui-event"
import { McpAuth } from "./auth"
import { McpCatalog } from "./catalog"
import { McpOAuthProvider } from "./oauth-provider"

const DEFAULT_TIMEOUT = 30_000

const CLIENT_OPTIONS = {
  capabilities: {
    // https://github.com/anomalyco/opencode/issues/11948
    // sampling: {},
    // https://github.com/anomalyco/opencode/issues/23066
    // elicitation: {},
    // https://github.com/anomalyco/opencode/issues/2308
    roots: {},
    // https://github.com/anomalyco/opencode/issues/28567
    // tasks: {},
  },
} satisfies ClientOptions

type McpClient = Client
type Transport = StdioClientTransport | StreamableHTTPClientTransport | SSEClientTransport

/**
 * Normalized, config-schema-agnostic description of a single MCP server.
 * `adapterV1` / `adapterV2` build one from each config schema; the connection
 * engine only depends on this shape so it is shared by the V1 MCP service and
 * the Location-scoped V2 tool source without pulling in either config schema.
 */
export interface McpServer {
  readonly type: "local" | "remote"
  readonly enabled: boolean
  // local
  readonly command?: readonly string[]
  readonly cwd?: string
  readonly environment?: Record<string, string>
  // remote
  readonly url?: string
  readonly headers?: Record<string, string>
  readonly oauth?: OAuth | false
  /** Connect/request timeout in milliseconds. */
  readonly timeout?: number
}

interface OAuth {
  readonly clientId?: string
  readonly clientSecret?: string
  readonly scope?: string
  readonly callbackPort?: number
  readonly redirectUri?: string
}

type V2Server = Schema.Schema.Type<typeof ConfigMCP.Server>
export type { V2Server }

/** Records the streamable transport used by a remote server for completing OAuth. */
type TransportWithAuth = StreamableHTTPClientTransport | SSEClientTransport
const pendingOAuthTransports = new Map<string, { transport: TransportWithAuth; provider?: unknown }>()

const v2Timeout = (timeout: { readonly startup?: number; readonly request?: number } | undefined): number | undefined =>
  timeout?.request ?? timeout?.startup

/** V2 config nests servers under `mcp.servers`; map one entry into the neutral shape. */
export const toMcpServer = (mcp: V2Server): McpServer =>
  mcp.type === "local"
    ? {
        type: "local",
        enabled: mcp.disabled !== true,
        command: mcp.command,
        cwd: mcp.cwd,
        environment: mcp.environment,
        timeout: v2Timeout(mcp.timeout),
      }
    : {
        type: "remote",
        enabled: mcp.disabled !== true,
        url: mcp.url,
        headers: mcp.headers,
        oauth:
          mcp.oauth === false
            ? false
            : mcp.oauth
              ? {
                  clientId: mcp.oauth.client_id,
                  clientSecret: mcp.oauth.client_secret,
                  scope: mcp.oauth.scope,
                  callbackPort: mcp.oauth.callback_port,
                  redirectUri: mcp.oauth.redirect_uri,
                }
              : undefined,
        timeout: v2Timeout(mcp.timeout),
      }

export const StatusConnected = Schema.Struct({ status: Schema.Literal("connected") }).annotate({
  identifier: "MCPStatusConnected",
})
export const StatusDisabled = Schema.Struct({ status: Schema.Literal("disabled") }).annotate({
  identifier: "MCPStatusDisabled",
})
export const StatusFailed = Schema.Struct({ status: Schema.Literal("failed"), error: Schema.String }).annotate({
  identifier: "MCPStatusFailed",
})
export const StatusNeedsAuth = Schema.Struct({ status: Schema.Literal("needs_auth") }).annotate({
  identifier: "MCPStatusNeedsAuth",
})
export const StatusNeedsClientRegistration = Schema.Struct({
  status: Schema.Literal("needs_client_registration"),
  error: Schema.String,
}).annotate({ identifier: "MCPStatusNeedsClientRegistration" })

export const Status = Schema.Union([
  StatusConnected,
  StatusDisabled,
  StatusFailed,
  StatusNeedsAuth,
  StatusNeedsClientRegistration,
]).annotate({ identifier: "MCPStatus", discriminator: "status" })
export type Status = Schema.Schema.Type<typeof Status>

export interface CreateResult {
  mcpClient?: McpClient
  status: Status
  defs?: MCPToolDef[]
  instructions?: string
}

export interface ConnectDeps {
  readonly auth: McpAuth.Interface
  readonly events: Event.Interface
}

function createClient(directory: string) {
  const client = new Client({ name: "opencode", version: InstallationVersion }, CLIENT_OPTIONS)
  client.setRequestHandler(ListRootsRequestSchema, () =>
    Promise.resolve({ roots: [{ uri: pathToFileURL(directory).href }] }),
  )
  return client
}

function remoteURL(value: string) {
  if (URL.canParse(value)) return new URL(value)
}

/**
 * Establish (or attempt to establish) a single MCP server connection for an
 * explicit directory. Pure connection: no state, no server "watch", no
 * disconnect bookkeeping — callers own the returned client and its lifecycle.
 * Errors surface as a structured `Status` rather than failing the effect.
 */
export const connectServer = Effect.fn("MCP.connectServer")(
  function* (directory: string, key: string, mcp: McpServer, deps: ConnectDeps) {
    if (mcp.enabled === false) {
      return yield* Effect.succeed<CreateResult>({ status: { status: "disabled" } })
    }

    const connectTransport = Effect.fn("MCP.connectTransport")(function* (transport: Transport, timeout: number) {
      return yield* Effect.acquireUseRelease(
        Effect.succeed(transport),
        (t) =>
          Effect.tryPromise({
            try: () => {
              const client = createClient(directory)
              return withTimeout(client.connect(t), timeout).then(() => client)
            },
            catch: (e) => (e instanceof Error ? e : new Error(String(e))),
          }),
        (t, exit) => (Exit.isFailure(exit) ? Effect.tryPromise(() => t.close()).pipe(Effect.ignore) : Effect.void),
      )
    })

    const connectRemote = Effect.fn("MCP.connectRemote")(function* (mcp: McpServer & { type: "remote" }) {
      const oauthDisabled = mcp.oauth === false
      const oauthConfig = mcp.oauth === false || mcp.oauth === undefined ? undefined : mcp.oauth
      const url = remoteURL(mcp.url ?? "")
      if (!url) {
        return {
          client: undefined as McpClient | undefined,
          status: { status: "failed" as const, error: `Invalid MCP URL for "${key}"` },
        }
      }
      let authProvider: McpOAuthProvider | undefined

      if (!oauthDisabled) {
        authProvider = new McpOAuthProvider(
          key,
          mcp.url ?? "",
          {
            clientId: oauthConfig?.clientId,
            clientSecret: oauthConfig?.clientSecret,
            scope: oauthConfig?.scope,
            callbackPort: oauthConfig?.callbackPort,
            redirectUri: oauthConfig?.redirectUri,
          },
          {
            onRedirect: async () => {},
          },
          deps.auth,
        )
      }

      const transports: Array<{ name: string; transport: TransportWithAuth }> = [
        {
          name: "StreamableHTTP",
          transport: new StreamableHTTPClientTransport(url, {
            authProvider,
            requestInit: mcp.headers ? { headers: mcp.headers } : undefined,
          }),
        },
        {
          name: "SSE",
          transport: new SSEClientTransport(url, {
            authProvider,
            requestInit: mcp.headers ? { headers: mcp.headers } : undefined,
          }),
        },
      ]

      const connectTimeout = mcp.timeout ?? DEFAULT_TIMEOUT
      let lastStatus: Status | undefined

      for (const { name, transport } of transports) {
        const result = yield* connectTransport(transport, connectTimeout).pipe(
          Effect.map((client) => ({ client, transportName: name })),
          Effect.catch((error) => {
            const lastError = error instanceof Error ? error : new Error(String(error))
            const isAuthError =
              error instanceof UnauthorizedError || (authProvider && lastError.message.includes("OAuth"))

            if (isAuthError) {
              if (lastError.message.includes("registration") || lastError.message.includes("client_id")) {
                lastStatus = {
                  status: "needs_client_registration" as const,
                  error: "Server does not support dynamic client registration. Please provide clientId in config.",
                }
                return deps.events
                  .publish(TuiEvent.ToastShow, {
                    title: "MCP Authentication Required",
                    message: `Server "${key}" requires a pre-registered client ID. Add clientId to your config.`,
                    variant: "warning",
                    duration: 8000,
                  })
                  .pipe(Effect.ignore, Effect.as(undefined))
              } else {
                pendingOAuthTransports.set(key, { transport })
                lastStatus = { status: "needs_auth" as const }
                return deps.events
                  .publish(TuiEvent.ToastShow, {
                    title: "MCP Authentication Required",
                    message: `Server "${key}" requires authentication. Run: opencode mcp auth ${key}`,
                    variant: "warning",
                    duration: 8000,
                  })
                  .pipe(Effect.ignore, Effect.as(undefined))
              }
            }

            lastStatus = { status: "failed" as const, error: lastError.message }
            return Effect.void
          }),
        )
        if (result) return { client: result.client, status: { status: "connected" } as Status }
        // If this was an auth error, stop trying other transports
        if (lastStatus?.status === "needs_auth" || lastStatus?.status === "needs_client_registration") break
      }

      return {
        client: undefined as McpClient | undefined,
        status: (lastStatus ?? { status: "failed", error: "Unknown error" }) as Status,
      }
    })

    const connectLocal = Effect.fn("MCP.connectLocal")(function* (mcp: McpServer & { type: "local" }) {
      const [cmd, ...args] = mcp.command ?? []
      const cwd = mcp.cwd ? path.resolve(directory, mcp.cwd) : directory
      const transport = new StdioClientTransport({
        stderr: "pipe",
        command: cmd,
        args,
        cwd,
        env: {
          ...process.env,
          ...(cmd === "opencode" ? { BUN_BE_BUN: "1" } : {}),
          ...mcp.environment,
        },
      })

      const connectTimeout = mcp.timeout ?? DEFAULT_TIMEOUT
      return yield* connectTransport(transport, connectTimeout).pipe(
        Effect.map((client): { client: McpClient | undefined; status: Status } => ({
          client,
          status: { status: "connected" },
        })),
        Effect.catch((error): Effect.Effect<{ client: McpClient | undefined; status: Status }> => {
          const msg = error instanceof Error ? error.message : String(error)
          return Effect.succeed({ client: undefined, status: { status: "failed", error: msg } })
        }),
      )
    })

    const { client: mcpClient, status } =
      mcp.type === "remote"
        ? yield* connectRemote(mcp as McpServer & { type: "remote" })
        : yield* connectLocal(mcp as McpServer & { type: "local" })

    if (!mcpClient) {
      if (status.status !== "connected" && status.status !== "disabled") {
        yield* Effect.logWarning("server unavailable", { key, type: mcp.type, status: status.status })
      }
      return { status } satisfies CreateResult
    }

    return yield* Effect.gen(function* () {
      const listed = mcpClient.getServerCapabilities()?.tools ? yield* McpCatalog.defs(mcpClient, mcp.timeout) : []
      if (!listed) {
        return yield* Effect.fail(new Error("Failed to get tools"))
      }
      return {
        mcpClient,
        status,
        defs: listed,
        instructions: mcpClient.getInstructions()?.trim(),
      } satisfies CreateResult
    }).pipe(
      Effect.catchCause((cause) =>
        Effect.tryPromise(() => mcpClient.close()).pipe(Effect.ignore, Effect.andThen(Effect.failCause(cause))),
      ),
    )
  },
  Effect.map((result): CreateResult => result),
  Effect.catchCause((cause) => {
    if (Cause.hasInterruptsOnly(cause)) return Effect.interrupt
    const error = Cause.squash(cause)
    return Effect.succeed<CreateResult>({
      status: { status: "failed", error: error instanceof Error ? error.message : String(error) },
    })
  }),
)
