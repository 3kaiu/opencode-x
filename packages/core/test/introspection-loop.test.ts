import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { Introspection, type DecisionRecord } from "../src/introspection/attribution"
import { Loop, confirmLessonAfterReuse, sedimentLesson, runMetacognition } from "../src/introspection/loop"
import { Memory, type MemoryStore } from "../src/memory/store"
import { Sediment } from "../src/memory/sediment"
import { tmpdir } from "./fixture/tmpdir"

const record = (over: Partial<DecisionRecord> = {}): DecisionRecord => ({
  turn: 1,
  contextFingerprint: "ctx",
  action: { tool: "read", args: {}, decision: "read file" },
  result: { outcome: "success" },
  seq: 1,
  ...over,
})

function withMemory(run: (store: MemoryStore) => Promise<void>): Promise<void> {
  return Effect.runPromise(
    Effect.gen(function* () {
      const tmp = yield* Effect.promise(() => tmpdir())
      try {
        const memory = yield* Effect.promise(() => Memory.openMemory(tmp.path))
        yield* Effect.promise(() => run(memory))
      } finally {
        yield* Effect.promise(() => tmp[Symbol.asyncDispose]())
      }
    }),
  )
}

describe("Memory wire log", () => {
  test("openMemory / appendWire / replayWire round-trip", () =>
    withMemory(async (store) => {
      const entry = {
        id: Memory.nextID(),
        category: "lesson" as const,
        title: "t",
        content: "c",
        keywords: [],
        created_at: 1,
        updated_at: 2,
        status: "pending" as const,
      }
      await Memory.appendWire(store, { type: "memory.upsert", entry })
      const entries = await Memory.replayWire(store)
      expect(entries.get(entry.id)).toEqual(entry)
      await Memory.appendWire(store, { type: "memory.delete", id: entry.id })
      expect((await Memory.replayWire(store)).size).toBe(0)
    }))

  test("replayWire tolerates a trailing partial line", () =>
    withMemory(async (store) => {
      await Memory.appendWire(store, {
        type: "memory.upsert",
        entry: {
          id: "a", category: "user", title: "t", content: "c", keywords: [],
          created_at: 1, updated_at: 1, status: "confirmed",
        },
      })
      const { appendFile } = await import("fs/promises")
      await appendFile(store.wirePath, `{"type":"memory.upsert","entry":{"id":"partial"\n`)
      const entries = await Memory.replayWire(store)
      expect(entries.get("a")).toBeDefined()
      expect(entries.size).toBe(1)
    }))

  test("state snapshot round-trip sorted by updated_at", () =>
    withMemory(async (store) => {
      const a = { id: "a", category: "user" as const, title: "a", content: "a", keywords: [], created_at: 1, updated_at: 1, status: "pending" as const }
      const b = { ...a, id: "b", title: "b", updated_at: 2 }
      await Memory.writeState(store, [a, b])
      const state = await Memory.readState(store)
      expect(state.map((e) => e.id)).toEqual(["b", "a"])
    }))
})

describe("Sediment", () => {
  test("sedimentSignal classifies NotFound tool failures as lessons", () => {
    const entry = Sediment.sedimentSignal({
      kind: "tool.failed",
      tool: "read",
      error: "No such file",
      category: "NotFound",
      at: 1,
    })
    expect(entry?.category).toBe("lesson")
    expect(entry?.title).toContain("read")
    expect(entry?.keywords).toContain("probe")
  })

  test("unknown category yields no rule", () => {
    const entry = Sediment.sedimentSignal({ kind: "tool.failed", tool: "x", error: "e", category: "Unknown", at: 1 })
    expect(entry).toBeNull()
  })

  test("permission denials become feedback", () => {
    const entry = Sediment.sedimentSignal({
      kind: "permission.decision",
      action: "edit",
      resource: "secret",
      decision: "deny",
      at: 1,
    })
    expect(entry?.category).toBe("feedback")
    expect(entry?.keywords).toContain("deny")
  })

  test("recordPending deduplicates within 24h and stops on confirmed", () =>
    withMemory(async (store) => {
      const signal = { kind: "tool.failed" as const, tool: "read", error: "No such file", category: "NotFound", at: Date.now() }
      const first = await Sediment.recordPending(store, signal)
      expect(first).not.toBeNull()
      expect(await Sediment.recordPending(store, signal)).toBeNull()
      await Memory.appendWire(store, { type: "memory.upsert", entry: { ...first!, status: "confirmed", updated_at: Date.now() } })
      expect(await Sediment.recordPending(store, { ...signal, at: Date.now() + 1000 })).toBeNull()
    }))

  test("promoteIfReused promotes after threshold", () =>
    withMemory(async (store) => {
      const entry = await Sediment.recordPending(store, {
        kind: "tool.failed", tool: "read", error: "No such file", category: "NotFound", at: Date.now(),
      })
      expect(await Sediment.promoteIfReused(store, entry!.id, 2)).toBe(false)
      expect(await Sediment.promoteIfReused(store, entry!.id, Sediment.REUSE_PROMOTION_THRESHOLD)).toBe(true)
      expect((await Memory.replayWire(store)).get(entry!.id)?.status).toBe("confirmed")
    }))
})

describe("Loop", () => {
  const store = (memory: MemoryStore): Loop.LoopContext => ({ memory })

  test("runMetacognition sediments lessons from failures", () =>
    withMemory(async (memory) => {
      const records = [
        record({ seq: 1, action: { tool: "read", args: {}, decision: "read package.json" }, result: { outcome: "failure", errorFingerprint: "No such file" } }),
        record({ seq: 2, action: { tool: "edit", args: {}, decision: "edit test" }, result: { outcome: "success" } }),
        record({ seq: 3, action: { tool: "edit", args: {}, decision: "edit test" }, result: { outcome: "success" } }),
      ]
      const result = await runMetacognition(store(memory), records, 2)
      expect(result.lessonID).not.toBeNull()
      const entries = await Memory.replayWire(memory)
      expect([...entries.values()].some((e) => e.category === "lesson")).toBe(true)
      expect(entries.get(result.lessonID!)?.content).toContain("probe")
    }))

  test("runMetacognition distills skill candidates from successful sessions", () =>
    withMemory(async (memory) => {
      const records = [
        record({ seq: 1, action: { tool: "read", args: {}, decision: "read package.json" } }),
        record({ seq: 2, action: { tool: "edit", args: {}, decision: "edit test" } }),
        record({ seq: 3, action: { tool: "edit", args: {}, decision: "edit test" } }),
      ]
      const result = await runMetacognition(store(memory), records, 2)
      expect(result.lessonID).toBeNull()
      expect(result.candidates.length).toBe(1)
      expect(result.candidates[0].status).toBe("pending")
    }))

  test("sedimentLesson returns null for unreported signals", () =>
    withMemory(async (memory) => {
      const r = record({ result: { outcome: "failure", errorFingerprint: "generic" } })
      const id = await sedimentLesson(store(memory), r, Introspection.attribute(r, []))
      expect(id).toBeNull()
    }))

  test("confirmLessonAfterReuse promotes the sedimented lesson", () =>
    withMemory(async (memory) => {
      const records = [record({ result: { outcome: "failure", errorFingerprint: "No such file" } })]
      const result = await runMetacognition(store(memory), records)
      expect(await confirmLessonAfterReuse(store(memory), result.lessonID!, 3)).toBe(true)
      const entries = await Memory.replayWire(memory)
      expect(entries.get(result.lessonID!)?.status).toBe("confirmed")
    }))
})
