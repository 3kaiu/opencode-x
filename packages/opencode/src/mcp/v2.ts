import { Effect, Layer } from "effect"
import { makeGlobalNode } from "@opencode-ai/core/effect/app-node"
import { MCP } from "@opencode-ai/core/tool/mcp"
import { MCP as MCPV1 } from "@/mcp"
import { McpCatalog } from "@/mcp/catalog"

// Adapts the existing V1 MCP client to the core V2 MCP interface so MCP tools register into the V2
// tool registry. Core stays free of the MCP wire protocol; this module is the host-side bridge.
// Note: cancellation (abort signal) is not plumbed through the core `MCP.call` interface yet, so
// `McpCatalog.callTool` is invoked without a signal here.
const layer = Layer.effect(
  MCP.Service,
  Effect.gen(function* () {
    const mcp = yield* MCPV1.Service
    return MCP.Service.of({
      tools: () =>
        Effect.gen(function* () {
          const tools = yield* mcp.tools()
          return Object.entries(tools).map(([name, entry]) => ({
            name,
            description: entry.def.description ?? "",
            inputSchema: (entry.def.inputSchema ?? {}) as Record<string, unknown>,
          }))
        }),
      call: (name, args) =>
        Effect.gen(function* () {
          const tools = yield* mcp.tools()
          const entry = tools[name]
          if (!entry) return yield* Effect.fail(new Error(`MCP tool not found: ${name}`))
          const result = yield* Effect.tryPromise({
            try: () => McpCatalog.callTool(entry.client, entry.def.name, args, entry.timeout),
            catch: (error) => (error instanceof Error ? error : new Error(String(error))),
          })
          return {
            content: (result.content ?? []) as MCP.ToolResultContent[],
            isError: result.isError === true,
          }
        }),
    })
  }),
)

export const node = makeGlobalNode({ service: MCP.Service, layer, deps: [MCPV1.node] })
