import { describe, expect, test } from "bun:test"
import { Effect, Ref, Scope } from "effect"
import { MutationQueue } from "@opencode-ai/core/session/runner/mutation-queue"
import { it } from "./lib/effect"

const log = (out: string[], name: string) => Effect.sync(() => out.push(name))

describe("MutationQueue", () => {
  it.live("serializes writes to the same file", () =>
    Effect.gen(function* () {
      const queue = yield* MutationQueue.make
      const order: string[] = []
      const effects = [0, 1, 2].map((i) =>
        queue.run({ kind: "file", path: "/tmp/same.ts" },
          log(order, `start${i}`).pipe(
            Effect.andThen(Effect.sleep(5)),
            Effect.andThen(log(order, `end${i}`)),
          ),
        ),
      )
      yield* Effect.forEach(effects, (e) => e, { concurrency: "unbounded" })
      expect(order).toEqual(["start0", "end0", "start1", "end1", "start2", "end2"])
    }))

  it.live("runs writes to different files in parallel", () =>
    Effect.gen(function* () {
      const queue = yield* MutationQueue.make
      const order: string[] = []
      const effects = ["a.ts", "b.ts", "c.ts"].map((file) =>
        queue.run({ kind: "file", path: `/tmp/${file}` },
          log(order, `start${file}`).pipe(Effect.andThen(Effect.sleep(10))),
        ),
      )
      yield* Effect.forEach(effects, (e) => e, { concurrency: "unbounded" })
      expect(order.filter((s) => s.startsWith("start")).sort()).toEqual(["starta.ts", "startb.ts", "startc.ts"])
      expect(order[0]).toBe("starta.ts")
      expect(order[1]).toBe("startb.ts")
      expect(order[2]).toBe("startc.ts")
    }))

  it.live("waits for in-flight writes before running an exclusive tool", () =>
    Effect.gen(function* () {
      const queue = yield* MutationQueue.make
      const order: string[] = []
      const writeDone = yield* Ref.make(false)
      const exclusive = yield* Ref.make(false)
      const write = queue.run({ kind: "file", path: "/tmp/a.ts" },
        log(order, "write").pipe(
          Effect.andThen(Effect.sleep(20)),
          Effect.andThen(Ref.set(writeDone, true)),
        ),
      )
      const bash = queue.run({ kind: "exclusive" },
        log(order, "bash").pipe(Effect.andThen(Ref.set(exclusive, true))),
      )
      yield* write.pipe(Effect.forkIn(yield* Scope.Scope, { startImmediately: true }))
      yield* Effect.sleep(2)
      yield* bash.pipe(Effect.forkIn(yield* Scope.Scope, { startImmediately: true }))
      yield* Effect.sleep(5)
      expect(yield* Ref.get(exclusive)).toBe(false)
      expect(yield* Ref.get(writeDone)).toBe(false)
      yield* Effect.sleep(30)
      expect(yield* Ref.get(writeDone)).toBe(true)
      expect(yield* Ref.get(exclusive)).toBe(true)
      expect(order).toEqual(["write", "bash"])
    }))

  it.live("blocks writes while an exclusive tool runs", () =>
    Effect.gen(function* () {
      const queue = yield* MutationQueue.make
      const order: string[] = []
      const bashDone = yield* Ref.make(false)
      const writeDone = yield* Ref.make(false)
      const bash = queue.run({ kind: "exclusive" },
        log(order, "bash").pipe(Effect.andThen(Effect.sleep(20)), Effect.andThen(Ref.set(bashDone, true))),
      )
      const write = queue.run({ kind: "file", path: "/tmp/b.ts" },
        log(order, "write").pipe(Effect.andThen(Ref.set(writeDone, true))),
      )
      yield* bash.pipe(Effect.forkIn(yield* Scope.Scope, { startImmediately: true }))
      yield* Effect.sleep(2)
      yield* write.pipe(Effect.forkIn(yield* Scope.Scope, { startImmediately: true }))
      yield* Effect.sleep(5)
      expect(yield* Ref.get(writeDone)).toBe(false)
      yield* Effect.sleep(30)
      expect(yield* Ref.get(bashDone)).toBe(true)
      expect(yield* Ref.get(writeDone)).toBe(true)
      expect(order).toEqual(["bash", "write"])
    }))

  it.live("never blocks unlocked accesses", () =>
    Effect.gen(function* () {
      const queue = yield* MutationQueue.make
      const order: string[] = []
      const write = queue.run({ kind: "file", path: "/tmp/c.ts" },
        Effect.sleep(20).pipe(Effect.andThen(log(order, "write"))),
      )
      const read = queue.run({ kind: "none" }, log(order, "read"))
      yield* write.pipe(Effect.forkIn(yield* Scope.Scope, { startImmediately: true }))
      yield* Effect.sleep(2)
      yield* read
      expect(order).toEqual(["read"])
    }))

  describe("accessOfCall", () => {
    test("derives a per-file access from a relative write path", () => {
      expect(MutationQueue.accessOfCall({ name: "write", input: { path: "src/a.ts", content: "x" } }, "/workspace")).toEqual({
        kind: "file",
        path: "/workspace/src/a.ts",
      })
    })

    test("keeps absolute paths as-is", () => {
      expect(MutationQueue.accessOfCall({ name: "edit", input: { path: "/tmp/abs.ts" } }, "/workspace")).toEqual({
        kind: "file",
        path: "/tmp/abs.ts",
      })
    })

    test("treats bash as exclusive", () => {
      expect(MutationQueue.accessOfCall({ name: "bash", input: { command: "ls" } }, "/workspace")).toEqual({
        kind: "exclusive",
      })
    })

    test("leaves readers and non-path tools unlocked", () => {
      expect(MutationQueue.accessOfCall({ name: "read", input: { path: "a.ts" } }, "/workspace")).toEqual({ kind: "none" })
      expect(MutationQueue.accessOfCall({ name: "glob", input: {} }, "/workspace")).toEqual({ kind: "none" })
    })
  })
})
