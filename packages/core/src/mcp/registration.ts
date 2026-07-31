export * as McpRegistration from "./registration"

import { ToolFailure } from "@opencode-ai/llm"
import { Effect, Layer, Schema } from "effect"
import { makeLocationNode } from "../effect/app-node"
import { ToolRegistry } from "../tool/registry"
import { Tool } from "../tool/tool"
import { Tools } from "../tool/tools"
import { McpToolSource } from "./tool-source"

const sanitize = (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, "_")
const toolName = (serverName: string, name: string) => sanitize(serverName) + "_" + sanitize(name)

const Output = Schema.Struct({
  content: Schema.Array(Schema.Unknown),
  isError: Schema.optional(Schema.Boolean),
  structuredContent: Schema.optional(Schema.Unknown),
})

function toModelOutput(output: Schema.Schema.Type<typeof Output>): ReadonlyArray<Tool.Content> {
  const parts: Tool.Content[] = []
  for (const item of output.content) {
    if (typeof item !== "object" || item === null) continue
    const part = item as Record<string, unknown>
    if (part.type === "text" && typeof part.text === "string") {
      parts.push({ type: "text", text: part.text })
    } else if (part.type === "image" && typeof part.data === "string" && typeof part.mimeType === "string") {
      parts.push({ type: "file", data: part.data, mime: part.mimeType })
    } else if (part.type === "resource" && typeof part.resource === "object" && part.resource !== null) {
      const resource = part.resource as Record<string, unknown>
      if (typeof resource.text === "string") parts.push({ type: "text", text: resource.text })
      if (typeof resource.blob === "string" && typeof resource.mimeType === "string") {
        parts.push({ type: "file", data: resource.blob, mime: resource.mimeType })
      }
    }
  }
  if (parts.length === 0 && output.structuredContent !== undefined) {
    parts.push({ type: "text", text: JSON.stringify(output.structuredContent) })
  }
  return parts
}

const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const source = yield* McpToolSource.Service
    const tools = yield* Tools.Service
    const entries = yield* source.tools

    if (entries.length === 0) return

    const record: Record<string, Tool.AnyTool> = {}
    for (const entry of entries) {
      const name = toolName(entry.serverName, entry.def.name)
      record[name] = Tool.make({
        description: entry.def.description ?? `MCP tool ${entry.def.name} from ${entry.serverName}`,
        input: Schema.Record(Schema.String, Schema.Unknown),
        inputJsonSchema: {
          ...entry.def.inputSchema,
          type: "object",
          properties: (entry.def.inputSchema.properties ?? {}) as Record<string, unknown>,
          additionalProperties: false,
        },
        output: Output,
        execute: (input) =>
          source.execute(entry.serverName, entry.def.name, input, { timeout: entry.timeout }).pipe(
            Effect.mapError(
              (error) => new ToolFailure({ message: error.message }),
            ),
            Effect.flatMap((result) => {
              if (result.isError) {
                const text = result.content
                  .filter((item): item is { type: "text"; text: string } => item.type === "text")
                  .map((item) => item.text)
                  .filter((text) => text.trim())
                  .join("\n\n")
                return Effect.fail(new ToolFailure({ message: text || "MCP tool returned an error" }))
              }
              return Effect.succeed({
                content: result.content as Array<unknown>,
                isError: result.isError,
                structuredContent: result.structuredContent,
              })
            }),
          ),
        toModelOutput: ({ output }) => toModelOutput(output),
      })
    }

    yield* tools.register(record).pipe(Effect.orDie)
  }),
)

export const node = makeLocationNode({
  name: "mcp-registration",
  layer,
  deps: [ToolRegistry.node, McpToolSource.node],
})
