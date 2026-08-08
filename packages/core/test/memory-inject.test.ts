import { describe, expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import { Observability } from "@opencode-ai/observability"
import { makeObservability } from "@opencode-ai/observability/service"
import { defaultRunContext } from "@opencode-ai/observability/context/index"
import { MemoryInject } from "../src/memory/inject"
import type { MemoryEntry } from "../src/memory/store"
import { testEffect } from "./lib/effect"

const it = testEffect(MemoryInject.layer)

const entry = (over: Partial<MemoryEntry>): MemoryEntry => ({
  id: "m1",
  category: "lesson",
  title: "title",
  content: "content",
  keywords: [],
  created_at: 1,
  updated_at: 2,
  status: "confirmed",
  ...over,
})

const entries: ReadonlyArray<MemoryEntry> = [
  entry({ id: "typecheck", title: "run typecheck", content: "always run bun typecheck after editing" }),
  entry({ id: "probe", title: "probe first", content: "use read before editing" }),
  entry({ id: "deploy", title: "deploy steps", content: "build then push" }),
]

describe("MemoryInject.inject", () => {
  test("ranks by query relevance", () => {
    const result = MemoryInject.inject(entries, { query: "typecheck bun", topK: 3 })
    expect(result.pieces.length).toBeGreaterThan(0)
    expect(result.pieces[0].ref).toEqual({ kind: "memory", memoryID: "typecheck" })
  })

  test("caps at topK", () => {
    const result = MemoryInject.inject(entries, { query: "always", topK: 1 })
    expect(result.pieces.length).toBe(1)
    expect(result.hits.length).toBe(1)
  })

  test("respects token budget", () => {
    const result = MemoryInject.inject(entries, { query: "always", topK: 3, budget: 2 })
    expect(result.droppedCount).toBeGreaterThan(0)
    expect(result.pieces.length + result.droppedCount).toBe(result.hits.length)
  })

  test("empty query yields nothing", () => {
    const result = MemoryInject.inject(entries, { query: "", topK: 3 })
    expect(result.pieces).toEqual([])
  })

  test("pieces carry provenance refs", () => {
    const result = MemoryInject.inject(entries, { query: "typecheck", topK: 3 })
    for (const piece of result.pieces) {
      expect(piece.layer).toBe("memory")
      expect(piece.ref?.kind).toBe("memory")
      expect(typeof piece.ref?.memoryID).toBe("string")
    }
  })
})

describe("MemoryInject service", () => {
  it.effect("records hit metrics", () =>
    Effect.gen(function* () {
      const service = yield* MemoryInject.Service
      const dir = `/tmp/memory-inject-obs-test-${Date.now()}`
      const obsLayer = Layer.succeed(Observability, makeObservability(dir, defaultRunContext))
      yield* service.inject(entries, { query: "typecheck", topK: 3 }).pipe(Effect.provide(obsLayer))
      const option = yield* Effect.serviceOption(Observability).pipe(Effect.provide(obsLayer))
      if (option._tag === "None") throw new Error("observability layer missing")
      const snapshot = option.value.snapshot()
      expect(snapshot.counters["memory.inject.hits{count=1}"]).toBe(1)
      yield* Effect.promise(() => Bun.$`rm -rf ${dir}`.then(() => undefined))
    }),
  )
})
