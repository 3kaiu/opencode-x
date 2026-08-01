export * as MCP from "./mcp"

import { Context, Duration, Effect, Layer, Schema } from "effect"
import { makeGlobalNode, makeLocationNode } from "../effect/app-node"
import { PermissionV2 } from "../permission"
import { Tool } from "./tool"
import { Tools } from "./tools"
import { ToolRegistry } from "./registry"

// Core stays free of the MCP wire protocol. The host (opencode) supplies a Client implementation
// wrapping the existing MCP client; core only knows how to list tool definitions and call them.
export interface ToolDefinition {
  /** Fully-qualified tool name, including the server prefix to avoid collisions. */
  readonly name: string
  readonly description: string
  readonly inputSchema: Record<string, unknown>
}

export interface ToolResultContent {
  readonly type: string
  readonly text?: string
}

export interface ToolResult {
  readonly content: ReadonlyArray<ToolResultContent>
  readonly isError?: boolean
}

export interface Interface {
  readonly tools: () => Effect.Effect<ReadonlyArray<ToolDefinition>>
  readonly call: (name: string, args: Record<string, unknown>) => Effect.Effect<ToolResult, Error>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/MCP") {}

// Default empty client: no MCP servers configured. The host replaces this node with a real client.
export const emptyLayer = Layer.succeed(
  Service,
  Service.of({
    tools: () => Effect.succeed([]),
    call: (name) => Effect.fail(new Error(`MCP is not available (tool ${name})`)),
  }),
)

export const node = makeGlobalNode({ service: Service, layer: emptyLayer, deps: [] })

const sanitize = (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, "_")

const permissionMessage = (error: unknown) =>
  error instanceof Error && error.message.length > 0
    ? error.message
    : "Tool call denied by permission policy"

// Window (attempts x interval) to wait for the global MCP client's async connections to establish
// before giving up on registering its tools into a Location.
const TOOL_RETRY_ATTEMPTS = 10
const TOOL_RETRY_INTERVAL = Duration.millis(2_000)

const textOf = (result: ToolResult) =>
  result.content
    .flatMap((item) => (item.type === "text" && item.text ? [item.text] : []))
    .join("\n\n")

// Iteration 1 uses a generic object input schema; preserving each MCP tool's JSON schema for the
// model is a documented follow-up. Execution forwards args to the server, which validates them.
// MCP tools are permission-gated like any leaf tool: the registered (server-qualified) name is the
// action, so a deny rule or a read-only subagent default-deny blocks execution and hides the tool.
const convert = (def: ToolDefinition, client: Interface, permission: PermissionV2.Interface): Tool.AnyTool =>
  Tool.make({
    description: def.description,
    input: Schema.Record(Schema.String, Schema.Unknown),
    output: Schema.Unknown,
    execute: (input, context) =>
      permission
        .assert({
          action: sanitize(def.name),
          resources: [],
          sessionID: context.sessionID,
          agent: context.agent,
          source: { type: "tool", messageID: context.assistantMessageID, callID: context.toolCallID },
        })
        .pipe(
          Effect.mapError((error) => new Tool.Failure({ message: permissionMessage(error) })),
          Effect.andThen(() =>
            client.call(def.name, input).pipe(
              Effect.mapError((error) => new Tool.Failure({ message: error.message })),
              Effect.flatMap((result) => {
                if (result.isError) {
                  const text = textOf(result)
                  return Effect.fail(new Tool.Failure({ message: text || "MCP tool returned an error" }))
                }
                return Effect.succeed(result)
              }),
            ),
          ),
        ),
    toModelOutput: ({ output }) => {
      const result = output as ToolResult
      const text = textOf(result)
      return [{ type: "text", text: text.length > 0 ? text : JSON.stringify(result.content) }]
    },
  })

// Location-scoped registration of MCP tools into the V2 tool registry. The MCP client is global
// (shared connections); each location registers the tools into its own registry. The MCP client
// connects asynchronously at startup, so a Location built before connections establish would
// otherwise register zero tools; a bounded, scoped retry picks them up shortly after.
export const toolLayer = Layer.effectDiscard(
  Effect.gen(function* () {
    const tools = yield* Tools.Service
    const client = yield* Service
    const permission = yield* PermissionV2.Service
    const register = (defs: ReadonlyArray<ToolDefinition>) =>
      tools
        .register(Object.fromEntries(defs.map((def) => [sanitize(def.name), convert(def, client, permission)])))
        .pipe(Effect.orDie)
    const defs = yield* client.tools()
    if (defs.length > 0) return yield* register(defs)
    yield* Effect.forkScoped(
      Effect.gen(function* () {
        for (let attempt = 0; attempt < TOOL_RETRY_ATTEMPTS; attempt++) {
          yield* Effect.sleep(TOOL_RETRY_INTERVAL)
          const pending = yield* client.tools()
          if (pending.length > 0) return yield* register(pending)
        }
      }).pipe(Effect.ignore),
    )
  }),
)

export const toolNode = makeLocationNode({
  name: "tool/mcp",
  layer: toolLayer,
  deps: [ToolRegistry.toolsNode, node, PermissionV2.node],
})
