import { describe, expect, it } from "bun:test"
import { Cause, Effect, Exit, Fiber, Option, Stream } from "effect"
import { stallTimeout } from "../src/route/transport/http"

describe("stallTimeout", () => {
  it("passes emitted elements through unchanged", async () => {
    const values = await Stream.make(1, 2, 3)
      .pipe(stallTimeout(), Stream.runCollect)
      .pipe(Effect.runPromise)
    expect(Array.from(values)).toEqual([1, 2, 3])
  })

  it("fails with a Transport Timeout error when the stream stays silent past the timeout", async () => {
    const program = Effect.gen(function* () {
      const fiber = yield* Stream.concat(Stream.make("a"), Stream.never)
        .pipe(stallTimeout("50 millis"), Stream.runCollect)
        .pipe(Effect.forkChild)
      const exit = yield* Fiber.await(fiber)
      expect(Exit.isFailure(exit)).toBe(true)
      // Unwrapped inside the generator this value is Effectable, so extract it
      // synchronously instead of yielding it through the effect channel.
      const failure = Option.getOrThrow(Cause.findErrorOption(exit.cause))
      expect(failure._tag).toBe("LLM.Error")
      expect(failure.reason._tag).toBe("Transport")
      expect(failure.reason.kind).toBe("Timeout")
    })
    await Effect.runPromise(program)
  })

  it("resets the timer on each emission", async () => {
    const program = Effect.gen(function* () {
      const fiber = yield* Stream.unfold(0, (n) =>
        Effect.sleep("5 millis").pipe(Effect.map(() => [n, n + 1] as const)),
      )
        .pipe(stallTimeout("100 millis"), Stream.take(10), Stream.runCollect)
        .pipe(Effect.forkChild)
      const values = yield* Fiber.join(fiber)
      // ~50ms of activity in 5ms gaps against a 100ms per-pull timer: the
      // timer must never trip, so all ten elements arrive.
      expect(Array.from(values)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
    })
    await Effect.runPromise(program)
  })
})
