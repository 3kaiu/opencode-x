import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { MCP } from "@opencode-ai/core/tool/mcp"
import { Tools } from "@opencode-ai/core/tool/tools"
import { PermissionV2 } from "@opencode-ai/core/permission"
import type { Tool } from "@opencode-ai/core/tool/tool"
import { testEffect } from "./lib/effect"

let registered: Record<string, Tool.AnyTool> = {}
const mockTools = Layer.succeed(
  Tools.Service,
  Tools.Service.of({
    register: (tools) =>
      Effect.sync(() => {
        registered = { ...registered, ...tools }
      }),
  }),
)
const mockMcp = Layer.succeed(
  MCP.Service,
  MCP.Service.of({
    tools: () =>
      Effect.succeed([
        { name: "testserver_echo", description: "Echo the input", inputSchema: { type: "object" } },
      ]),
    call: (_name, args) => Effect.succeed({ content: [{ type: "text", text: `echo:${JSON.stringify(args)}` }] }),
  }),
)
const mockPermission = Layer.mock(PermissionV2.Service, {
  assert: () => Effect.void,
})

const it = testEffect(Layer.mergeAll(mockTools, mockMcp, mockPermission))

describe("MCP V2 tool registration", () => {
  it.effect("converts and registers MCP tools into the V2 tool registry", () =>
    Effect.gen(function* () {
      registered = {}
      yield* Layer.build(MCP.toolLayer)
      expect(Object.keys(registered)).toContain("testserver_echo")
      expect(registered["testserver_echo"]).toBeDefined()
    }),
  )
})
