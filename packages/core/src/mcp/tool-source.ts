export * as McpToolSource from "./tool-source"

import { Context, Effect, Layer } from "effect"
import { makeGlobalNode } from "../effect/app-node"

/** JSON Schema definition for an MCP tool's input. */
export interface ToolDef {
  readonly name: string
  readonly description?: string
  readonly inputSchema: Record<string, unknown>
}

/** A discovered MCP tool with its owning server. */
export interface ToolEntry {
  readonly serverName: string
  readonly def: ToolDef
  readonly timeout?: number
}

export type ContentPart =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "image"; readonly data: string; readonly mimeType: string }
  | {
      readonly type: "resource"
      readonly resource: {
        readonly uri: string
        readonly text?: string
        readonly blob?: string
        readonly mimeType?: string
      }
    }

export interface ToolResult {
  readonly content: ReadonlyArray<ContentPart>
  readonly isError?: boolean
  readonly structuredContent?: unknown
}

export interface Interface {
  /** All currently connected MCP tools across servers. */
  readonly tools: Effect.Effect<ReadonlyArray<ToolEntry>>
  /** Execute a tool on a specific server. */
  readonly execute: (
    serverName: string,
    toolName: string,
    args: Record<string, unknown>,
    options?: { readonly signal?: AbortSignal; readonly timeout?: number },
  ) => Effect.Effect<ToolResult, Error>
}

/**
 * Abstract MCP tool source consumed by the V2 registration layer.
 * The actual MCP client implementation lives in the server package;
 * core only depends on this interface.
 */
export class Service extends Context.Service<Service, Interface>()("@opencode/v2/McpToolSource") {}

/** Default no-op source: no MCP tools available. */
export const noop: Interface = {
  tools: Effect.succeed([]),
  execute: (_serverName, toolName) =>
    Effect.fail(new Error(`MCP tool source not available (called ${toolName})`)),
}

/**
 * Process-scoped node with a no-op default. The server package replaces this
 * via `buildLocationServiceMap(replacements)` with a real implementation
 * backed by the MCP client.
 */
export const node = makeGlobalNode({
  service: Service,
  layer: Layer.succeed(Service, noop),
  deps: [],
})
