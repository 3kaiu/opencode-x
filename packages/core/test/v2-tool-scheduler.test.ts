import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import type { ToolCall, ToolOutput } from "@opencode-ai/llm"
import {
  accessesConflict,
  pathConflicts,
  planWaves,
  runBatch,
  type SchedulableTool,
} from "../src/v2/tools/scheduler"

const call = (id: string, name: string): ToolCall => ({ type: "tool-call", id, name, input: {} })

const tools: SchedulableTool[] = [
  { name: "read-a", access: [{ kind: "file", op: "read", path: "/repo/a.ts" }] },
  { name: "read-b", access: [{ kind: "file", op: "read", path: "/repo/b.ts" }] },
  { name: "write-a", access: [{ kind: "file", op: "write", path: "/repo/a.ts" }] },
  { name: "edit-dir", access: [{ kind: "file", op: "edit", path: "/repo/src", recursive: true }] },
  { name: "sequential-tool", executionMode: "sequential" },
  { name: "global-tool", access: [{ kind: "global" }] },
  { name: "net", access: [{ kind: "network" }] },
]

describe("pathConflicts", () => {
  test("exact and prefix containment", () => {
    expect(pathConflicts("/repo/a.ts", "/repo/a.ts")).toBe(true)
    expect(pathConflicts("/repo/a.ts", "/repo/")).toBe(true)
    expect(pathConflicts("/repo/src/x.ts", "/repo/src")).toBe(true)
    expect(pathConflicts("/repo/srcx", "/repo/src")).toBe(false)
    expect(pathConflicts("/repo/a.ts", "/repo/b.ts")).toBe(false)
  })
})

describe("accessesConflict", () => {
  test("read vs read never conflicts", () => {
    expect(accessesConflict({ kind: "file", op: "read", path: "/a" }, { kind: "file", op: "read", path: "/a" })).toBe(
      false,
    )
  })
  test("write vs read on same path conflicts", () => {
    expect(accessesConflict({ kind: "file", op: "write", path: "/a" }, { kind: "file", op: "read", path: "/a" })).toBe(
      true,
    )
  })
  test("write vs write on overlapping recursive paths conflicts", () => {
    expect(
      accessesConflict(
        { kind: "file", op: "write", path: "/repo/src", recursive: true },
        { kind: "file", op: "write", path: "/repo/src/x.ts" },
      ),
    ).toBe(true)
  })
  test("different files do not conflict", () => {
    expect(accessesConflict({ kind: "file", op: "write", path: "/a" }, { kind: "file", op: "write", path: "/b" })).toBe(
      false,
    )
  })
  test("global conflicts with everything", () => {
    expect(accessesConflict({ kind: "global" }, { kind: "file", op: "read", path: "/a" })).toBe(true)
    expect(accessesConflict({ kind: "global" }, { kind: "network" })).toBe(true)
  })
  test("network does not conflict with files", () => {
    expect(accessesConflict({ kind: "network" }, { kind: "file", op: "read", path: "/a" })).toBe(false)
  })
})

describe("planWaves", () => {
  test("independent reads share a wave", () => {
    const waves = planWaves([call("1", "read-a"), call("2", "read-b")], tools)
    expect(waves).toHaveLength(1)
    expect(waves[0].map((c) => c.id)).toEqual(["1", "2"])
  })
  test("write conflicts with read on same path → separate waves", () => {
    const waves = planWaves([call("1", "write-a"), call("2", "read-a")], tools)
    expect(waves).toHaveLength(2)
  })
  test("recursive edit conflicts with nested write, not with sibling", () => {
    const nestedCall: ToolCall = { type: "tool-call", id: "2", name: "write-src", input: {} }
    const nested = planWaves(
      [call("1", "edit-dir"), nestedCall],
      [...tools, { name: "write-src", access: [{ kind: "file", op: "write", path: "/repo/src/x.ts" }] }],
    )
    expect(nested).toHaveLength(2)
    const sibling = planWaves([call("1", "edit-dir"), call("2", "write-a")], tools)
    expect(sibling).toHaveLength(1)
  })
  test("sequential tool forces its wave alone", () => {
    const waves = planWaves([call("1", "sequential-tool"), call("2", "read-a")], tools)
    expect(waves).toHaveLength(2)
  })
  test("call-level accessOf derives real paths: independent files share a wave", () => {
    const pathOf = (c: ToolCall) => {
      const p = (c.input as { path?: string }).path ?? ""
      return [{ kind: "file" as const, op: "write" as const, path: p }]
    }
    const a: ToolCall = { type: "tool-call", id: "1", name: "write", input: { path: "/repo/src/a.ts" } }
    const b: ToolCall = { type: "tool-call", id: "2", name: "write", input: { path: "/repo/src/b.ts" } }
    expect(planWaves([a, b], [{ name: "write" }], pathOf)).toHaveLength(1)
  })
  test("call-level accessOf still serializes same-file writes", () => {
    const pathOf = (c: ToolCall) => {
      const p = (c.input as { path?: string }).path ?? ""
      return [{ kind: "file" as const, op: "write" as const, path: p }]
    }
    const a: ToolCall = { type: "tool-call", id: "1", name: "write", input: { path: "/repo/src/a.ts" } }
    const b: ToolCall = { type: "tool-call", id: "2", name: "write", input: { path: "/repo/src/a.ts" } }
    expect(planWaves([a, b], [{ name: "write" }], pathOf)).toHaveLength(2)
  })
  test("global tool conflicts with everything", () => {
    const waves = planWaves([call("1", "global-tool"), call("2", "read-a"), call("3", "read-b")], tools)
    expect(waves).toHaveLength(2)
    expect(waves[0]).toHaveLength(1)
  })
  test("network tool is independent of files", () => {
    const waves = planWaves([call("1", "net"), call("2", "read-a")], tools)
    expect(waves).toHaveLength(1)
  })
})

describe("runBatch", () => {
  test("returns results in source order regardless of completion order", async () => {
    const order: string[] = []
    const result = await Effect.runPromise(
      runBatch({
        calls: [call("1", "read-a"), call("2", "read-b")],
        tools,
        execute: (c) =>
          Effect.sync(() => {
            order.push(c.id)
            return { structured: null, content: [{ type: "text", text: `result-${c.id}` }] } as ToolOutput
          }),
      }),
    )
    expect(result.map((r) => r.content[0].type === "text" && r.content[0].text)).toEqual(["result-1", "result-2"])
  })

  test("same-wave calls execute concurrently (async settles interleave)", async () => {
    let inflight = 0
    let max = 0
    const order: string[] = []
    await Effect.runPromise(
      runBatch({
        calls: [call("1", "read-a"), call("2", "read-b")],
        tools,
        execute: (c) =>
          Effect.gen(function* () {
            inflight++
            max = Math.max(max, inflight)
            yield* Effect.promise(() => new Promise((r) => setTimeout(r, c.id === "1" ? 30 : 5)))
            inflight--
            order.push(c.id)
            return { structured: null, content: [] } as ToolOutput
          }),
      }),
    )
    expect(max).toBe(2)
    expect(order).toEqual(["2", "1"])
  })

  test("conflicting writes split into waves and run serially", async () => {
    let inflight = 0
    let max = 0
    await Effect.runPromise(
      runBatch({
        calls: [call("1", "write-a"), call("2", "read-a")],
        tools,
        execute: (c) =>
          Effect.gen(function* () {
            inflight++
            max = Math.max(max, inflight)
            yield* Effect.promise(() => new Promise((r) => setTimeout(r, 10)))
            inflight--
            return { structured: null, content: [] } as ToolOutput
          }),
      }),
    )
    expect(max).toBe(1)   // same-path write vs read never overlap
  })
})
