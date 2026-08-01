export * as McpV2Source from "./v2-source"

import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js"
import { McpToolSource } from "@opencode-ai/core/mcp/tool-source"
import { Config } from "@opencode-ai/core/config"
import { Location } from "@opencode-ai/core/location"
import { Effect, Layer } from "effect"
import { McpAuth } from "./auth"
import { EventV2Bridge } from "@/event-v2-bridge"
import { McpConnect, type CreateResult, type McpServer, type Status, type V2Server } from "./connect"

type McpClient = import("@modelcontextprotocol/sdk/client/index.js").Client

/**
 * Location-scoped MCP tool source. Each location owns its own connected MCP
 * clients keyed by the location's directory; unlike the V1 `MCP.Service` it
 * does NOT depend on `InstanceRef`, so it can be used from the V2 session
 * routes (whose `SessionLocationMiddleware` only provides Location services).
 */
const layer = Layer.effect(
  McpToolSource.Service,
  Effect.gen(function* () {
    const location = yield* Location.Service
    const cfgSvc = yield* Config.Service
    const auth = yield* McpAuth.Service
    const events = yield* EventV2Bridge.Service

    const deps = { auth, events }
    const directory = location.directory

    const servers = (Config.latest(yield* cfgSvc.entries(), "mcp")?.servers ?? {}) as Record<string, V2Server>

    const state: {
      config: Record<string, McpServer>
      status: Record<string, Status>
      clients: Record<string, McpClient>
      defs: Record<string, NonNullable<CreateResult["defs"]>>
    } = { config: {}, status: {}, clients: {}, defs: {} }

    yield* Effect.forEach(
      Object.entries(servers),
      ([key, mcp]) =>
        Effect.gen(function* () {
          state.config[key] = McpConnect.toMcpServer(mcp)
          const result: CreateResult = yield* McpConnect.connectServer(directory, key, state.config[key], deps)
          state.status[key] = result.status
          if (result.mcpClient && result.defs) {
            state.clients[key] = result.mcpClient
            state.defs[key] = result.defs
          }
        }),
      { concurrency: "unbounded" },
    )

    yield* Effect.addFinalizer(() =>
      Effect.forEach(
        Object.values(state.clients),
        (client) => Effect.tryPromise(() => client.close()).pipe(Effect.ignore),
        { concurrency: "unbounded" },
      ).pipe(Effect.asVoid),
    )

    return McpToolSource.Service.of({
      tools: Effect.gen(function* () {
        const entries: McpToolSource.ToolEntry[] = []
        for (const [key, spec] of Object.entries(state.config)) {
          const client = state.clients[key]
          if (!client || state.status[key]?.status !== "connected") continue
          for (const def of state.defs[key] ?? []) {
            entries.push({ serverName: key, def, timeout: spec.timeout })
          }
        }
        return entries
      }),

      execute: (serverName, toolName, args, options) =>
        Effect.gen(function* () {
          const client = state.clients[serverName]
          const spec = state.config[serverName]
          if (!client) return yield* Effect.fail(new Error(`MCP server not connected: ${serverName}`))
          const result = yield* Effect.tryPromise({
            try: () =>
              client.callTool({ name: toolName, arguments: args }, CallToolResultSchema, {
                timeout: options?.timeout ?? spec?.timeout,
                signal: options?.signal,
                resetTimeoutOnProgress: true,
                onprogress: () => {},
              }),
            catch: (e) => (e instanceof Error ? e : new Error(String(e))),
          })
          return result as McpToolSource.ToolResult
        }),
    })
  }),
)

export { layer }
