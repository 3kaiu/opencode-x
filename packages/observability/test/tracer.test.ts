import { describe, expect, test } from "bun:test"
import { Effect, Exit, Layer, Option, Tracer } from "effect"
import { makeTracer } from "../src/tracer"

type SpanLine = {
  name: string
  spanId?: string
  parentSpanId?: string
  traceId?: string
  durationMs?: number
  attributes?: Record<string, unknown>
  exit?: unknown
}

const collect = () => {
  const lines: SpanLine[] = []
  return {
    lines,
    tracer: makeTracer({ enabled: () => true, emit: (line) => lines.push(line as SpanLine) }),
  }
}

describe("tracer", () => {
  test("emits an ended span line with attributes and duration", () => {
    const { lines, tracer } = collect()
    const span = tracer.span({
      name: "llm.stream",
      parent: Option.none(),
      annotations: undefined as never,
      links: [],
      startTime: 0n,
      kind: "internal",
      root: true,
      sampled: true,
    })
    span.attribute("provider", "openai")
    span.end(1_000_000n, Exit.succeed(undefined))

    expect(lines).toHaveLength(1)
    expect(lines[0]?.name).toBe("llm.stream")
    expect(lines[0]?.attributes).toEqual({ provider: "openai" })
    expect(lines[0]?.exit).toEqual({ _tag: "Success" })
    expect(typeof lines[0]?.durationMs).toBe("number")
    expect(lines[0]?.parentSpanId).toBeUndefined()
  })

  test("links child spans via parentSpanId and inherits traceId", () => {
    const { lines, tracer } = collect()
    const parent = tracer.span({
      name: "turn",
      parent: Option.none(),
      annotations: undefined as never,
      links: [],
      startTime: 0n,
      kind: "internal",
      root: true,
      sampled: true,
    })
    const child = tracer.span({
      name: "llm.first-token",
      parent: Option.some(parent),
      annotations: undefined as never,
      links: [],
      startTime: 0n,
      kind: "internal",
      root: false,
      sampled: parent.sampled,
    })
    parent.end(1_000_000n, Exit.succeed(undefined))
    child.end(2_000_000n, Exit.succeed(undefined))

    const turn = lines.find((line) => line.name === "turn")
    const firstToken = lines.find((line) => line.name === "llm.first-token")
    expect(firstToken?.parentSpanId).toBe(turn?.spanId)
    expect(firstToken?.traceId).toBe(turn?.traceId)
  })

  test("skips emission when disabled", () => {
    const lines: SpanLine[] = []
    const tracer = makeTracer({ enabled: () => false, emit: (line) => lines.push(line as SpanLine) })
    const span = tracer.span({
      name: "x",
      parent: Option.none(),
      annotations: undefined as never,
      links: [],
      startTime: 0n,
      kind: "internal",
      root: true,
      sampled: true,
    })
    span.end(1_000_000n, Exit.succeed(undefined))
    expect(lines).toHaveLength(0)
  })

  test("layer provides the Tracer service to withSpan", async () => {
    const lines: SpanLine[] = []
    const layer = Layer.succeed(
      Tracer.Tracer,
      makeTracer({ enabled: () => true, emit: (line) => lines.push(line as SpanLine) }),
    )
    await Effect.runPromise(
      Effect.withSpan("instrumented", { kind: "internal" })(Effect.succeed(1)).pipe(Effect.provide(layer)),
    )

    expect(lines.map((line) => line.name)).toEqual(["instrumented"])
  })
})
