export * as McpV2Source from "./v2-source"

import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js"
import { McpToolSource } from "@opencode-ai/core/mcp/tool-source"
import { Effect, Layer } from "effect"
import { MCP } from "."

/**
 * Bridges the process-scoped V1 MCP service into the V2 McpToolSource
 * interface consumed by core's MCP registration layer.
 */
const layer = Layer.effect(
  McpToolSource.Service,
  Effect.gen(function* () {
    const mcp = yield* MCP.Service

    return McpToolSource.Service.of({
      tools: Effect.gen(function* () {
        const clients = yield* mcp.clients()
        const clientToServer = new Map(Object.entries(clients).map(([name, client]) => [client, name]))
        const all = yield* mcp.tools()
        const entries: McpToolSource.ToolEntry[] = []
        for (const [, entry] of Object.entries(all)) {
          const serverName = clientToServer.get(entry.client) ?? "unknown"
          entries.push({
            serverName,
            def: {
              name: entry.def.name,
              description: entry.def.description,
              inputSchema: entry.def.inputSchema as Record<string, unknown>,
            },
            timeout: entry.timeout,
          })
        }
        return entries
      }),

      execute: (serverName, toolName, args, options) =>
        Effect.gen(function* () {
          const clients = yield* mcp.clients()
          const client = clients[serverName]
          if (!client) return yield* Effect.fail(new Error(`MCP server not connected: ${serverName}`))
          const result = yield* Effect.tryPromise({
            try: () =>
              client.callTool(
                { name: toolName, arguments: args },
                CallToolResultSchema,
                {
                  timeout: options?.timeout,
                  signal: options?.signal,
                  resetTimeoutOnProgress: true,
                  onprogress: () => {},
                },
              ),
            catch: (e) => (e instanceof Error ? e : new Error(String(e))),
          })
          return result as McpToolSource.ToolResult
        }),
    })
  }),
)

export { layer }
