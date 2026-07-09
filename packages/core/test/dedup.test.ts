import { expect, test } from "bun:test"
import { dedup } from "@opencode-ai/core/session/compaction"

const makeEntry = (seq: number, message: any) => ({ seq, message })

const makeToolResult = (name: string, input: Record<string, unknown>) => ({
  type: "tool" as const,
  id: "tool_1",
  name,
  state: {
    status: "completed" as const,
    input,
    content: [{ type: "text" as const, text: "result" }],
    structured: {},
  },
  time: { created: 100 as any, completed: 200 as any },
})

const mkAssistant = (seq: number, tools: readonly any[]) =>
  makeEntry(seq, {
    type: "assistant",
    id: "msg_" + seq,
    content: tools,
    time: { created: (seq * 100) as any },
  })

test("dedup removes duplicate tool calls with same name and input", () => {
  const entries = [
    mkAssistant(1, [makeToolResult("read", { path: "file.ts" })]),
    mkAssistant(2, [makeToolResult("read", { path: "file.ts" })]),
  ]
  const result = dedup(entries)
  expect(result).toHaveLength(1)
  expect(result[0].seq).toBe(2)
})

test("dedup keeps unique tool calls", () => {
  const entries = [
    mkAssistant(1, [makeToolResult("read", { path: "file1.ts" })]),
    mkAssistant(2, [makeToolResult("read", { path: "file2.ts" })]),
  ]
  const result = dedup(entries)
  expect(result).toHaveLength(2)
})

test("dedup removes old error tool calls after 10 messages", () => {
  const entries = [
    mkAssistant(1, [
      {
        type: "tool",
        id: "tool_1",
        name: "read",
        state: { status: "error", input: { path: "bad.ts" }, content: [], structured: {}, error: { type: "unknown", message: "failed" } },
        time: { created: 100 as any },
      },
    ]),
    ...Array.from({ length: 11 }, (_, i) => mkAssistant(i + 2, [makeToolResult("read", { path: `file${i}.ts` })])),
  ]
  const result = dedup(entries)
  expect(result).toHaveLength(11)
  expect(result.find((e) => e.seq === 1)).toBeUndefined()
})
