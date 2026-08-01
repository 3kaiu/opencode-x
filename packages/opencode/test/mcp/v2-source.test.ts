import { expect, it } from "bun:test"
import { Effect, Layer } from "effect"
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js"
import { CallToolRequestSchema, ListToolsRequestSchema, type Tool } from "@modelcontextprotocol/sdk/types.js"
import { Config } from "@opencode-ai/core/config"
import { ConfigMCP } from "@opencode-ai/core/config/mcp"
import { Location } from "@opencode-ai/core/location"
import { Project } from "@opencode-ai/core/project"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { McpToolSource } from "@opencode-ai/core/mcp/tool-source"
import { McpV2Source } from "../../src/mcp/v2-source"
import { McpAuth } from "../../src/mcp/auth"
import { EventV2Bridge } from "../../src/event-v2-bridge"

// Minimal MCP server exposing one tool that echoes its arguments. Mirrors the
// remote server setup used by the V1 lifecycle tests (test/mcp/lifecycle.test.ts).
async function mcpServer(tools: Tool[]) {
  const protocol = new Server({ name: "v2-source-test", version: "1.0.0" }, { capabilities: { tools: {} } })
  protocol.setRequestHandler(ListToolsRequestSchema, () => Promise.resolve({ tools }))
  protocol.setRequestHandler(CallToolRequestSchema, (request) => {
    const name = request.params.name
    const args = (request.params.arguments ?? {}) as Record<string, unknown>
    return Promise.resolve({ content: [{ type: "text", text: `called:${name}:${JSON.stringify(args)}` }] })
  })
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: () => crypto.randomUUID(),
    enableJsonResponse: true,
  })
  await protocol.connect(transport)
  const http = Bun.serve({ port: 0, fetch: (request) => transport.handleRequest(request) })
  return {
    url: http.url.toString(),
    close: async () => {
      await protocol.close().catch(() => {})
      http.stop(true)
    },
  }
}

function sourceLayer(url: string) {
  const mcp = new ConfigMCP.Info({
    servers: { test: new ConfigMCP.Remote({ type: "remote", url, oauth: false }) },
  })
  const directory = AbsolutePath.make(process.cwd())
  return McpV2Source.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(
          Config.Service,
          Config.Service.of({
            entries: () => Effect.succeed([new Config.Document({ type: "document", info: new Config.Info({ mcp }) })]),
          }),
        ),
        Layer.succeed(
          Location.Service,
          Location.Service.of({ directory, project: { id: Project.ID.global, directory } }),
        ),
        // connectServer never touches auth/events for a non-OAuth remote.
        Layer.succeed(McpAuth.Service, {} as McpAuth.Interface),
        Layer.succeed(EventV2Bridge.Service, {} as EventV2Bridge.Interface),
      ),
    ),
  )
}

it("lists and executes tools from location config without InstanceRef", async () => {
  const server = await mcpServer([{ name: "echo", inputSchema: { type: "object" } }])
  try {
    const result = await Effect.gen(function* () {
      const source = yield* McpToolSource.Service
      const tools = yield* source.tools
      const executed = yield* source.execute("test", "echo", { hello: "world" })
      return { tools, executed }
    })
      .pipe(Effect.scoped)
      .pipe(Effect.provide(sourceLayer(server.url)))
      .pipe(Effect.runPromise)

    expect(result.tools.map((t) => `${t.serverName}_${t.def.name}`)).toEqual(["test_echo"])
    expect(result.executed).toMatchObject({
      content: [{ type: "text", text: 'called:echo:{"hello":"world"}' }],
    })
  } finally {
    await server.close()
  }
})
