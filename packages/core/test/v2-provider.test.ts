import { describe, expect, test } from "bun:test"
import { Effect, Stream } from "effect"
import { Model, ModelID, Message, ToolDefinition, Usage, type LLMEvent } from "@opencode-ai/llm"
import { OpenAIResponses } from "@opencode-ai/llm/protocols/openai-responses"
import { Provider } from "../src/v2/execution/provider"
import { Projection } from "../src/v2/context/projection"

const mkModel = () =>
  Model.make({
    id: ModelID.make("gpt-test"),
    provider: "openai" as const,
    route: OpenAIResponses.route,
  })

describe("Provider.collectEvents", () => {
  test("maps text/thinking/toolcall events and captures tool input JSON", async () => {
    const stream = Stream.fromIterable<LLMEvent>([
      { type: "text-start", id: "b1" },
      { type: "text-delta", id: "b1", text: "Let me " },
      { type: "text-delta", id: "b1", text: "check." },
      { type: "text-end", id: "b1" },
      { type: "reasoning-start", id: "b2" },
      { type: "reasoning-delta", id: "b2", text: "hmm" },
      { type: "reasoning-end", id: "b2" },
      { type: "tool-input-start", id: "t1", name: "read" },
      { type: "tool-input-delta", id: "t1", name: "read", text: '{"path":' },
      { type: "tool-input-delta", id: "t1", name: "read", text: '"/a.ts"}' },
      { type: "tool-input-end", id: "t1", name: "read" },
      { type: "finish", reason: "tool-calls", usage: new Usage({ inputTokens: 10, outputTokens: 5, cacheReadInputTokens: 2, cacheWriteInputTokens: 0, reasoningTokens: 0 }) },
    ])
    const usageSeen: Array<object> = []
    const result = await Effect.runPromise(Provider.collectEvents(stream, (u) => usageSeen.push(u)))
    expect(result.stopReason).toBe("tool_use")
    expect(result.usage?.input).toBe(10)
    expect(result.usage?.output).toBe(5)
    expect(result.usage?.cacheRead).toBe(2)
    expect(result.events.filter((e) => e.kind === "text" && e.phase === "delta").map((e) => e.content)).toEqual([
      "Let me ",
      "check.",
    ])
    const toolcall = result.events.find((e) => e.kind === "toolcall" && e.phase === "end")
    expect(toolcall?.tool).toEqual({ id: "t1", name: "read", input: { path: "/a.ts" } })
  })

  test("surfaces provider errors as stopReason error (never throws)", async () => {
    const stream = Stream.fromIterable<LLMEvent>([
      { type: "provider-error", message: "500 internal", retryable: true },
    ])
    const result = await Effect.runPromise(Provider.collectEvents(stream))
    expect(result.stopReason).toBe("error")
  })
})

describe("Provider.buildRequest", () => {
  test("assembles LLMRequest from projected layers", () => {
    const projection = Projection.project({
      window: 20_000,
      system: [Projection.piece.system("You are an agent.")],
      world: [Projection.piece.world("cwd=/repo")],
      instructions: [Projection.piece.instruction("Use bun.")],
      memory: [],
      history: [Projection.piece.history("user: fix")],
      live: [Projection.piece.live("file changed")],
    })
    const request = Provider.buildRequest({
      projection,
      model: mkModel(),
      tools: [{ name: "read", definition: new ToolDefinition({ name: "read", description: "read file", inputSchema: {} }) }],
      prompt: "go",
      toolChoice: "auto",
    })
    expect(request.id).toBe(projection.fingerprint)
    expect(String(request.model.id)).toBe("gpt-test")
    expect(request.system?.length).toBe(3)
    expect(request.messages).toHaveLength(3) // history + live + prompt
    expect(request.tools?.[0].name).toBe("read")
  })
})
