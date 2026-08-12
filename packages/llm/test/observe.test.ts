import { describe, expect, test } from "bun:test"
import { Effect, Layer, Stream, Tracer } from "effect"
import { Observability, Tracer as ObsTracer } from "@opencode-ai/observability"
import { makeObservability } from "@opencode-ai/observability/service"
import { defaultRunContext } from "@opencode-ai/observability/context/index"
import fs from "fs"
import os from "os"
import path from "path"
import { LLM } from "../src"
import * as OpenAIChat from "../src/protocols/openai-chat"
import { LLMEvent, Model } from "../src/schema"
import { observeStream, observeStreamSpan } from "../src/route/observe"

const request = LLM.request({
  id: "req_1",
  model: Model.make({ id: "fake-model", provider: "fake", route: OpenAIChat.route }),
  prompt: "Say hello.",
})

const tracerLayer = (lines: Array<Record<string, unknown>>) =>
  Layer.succeed(
    Tracer.Tracer,
    ObsTracer.makeTracer({
      enabled: () => true,
      emit: (line) => lines.push(line as Record<string, unknown>),
    }),
  )

const runSpan = <A, E>(effect: Effect.Effect<A, E, never>, lines: Array<Record<string, unknown>>) =>
  Effect.runPromise(effect.pipe(Effect.provide(tracerLayer(lines))))

const stream = (events: LLMEvent[]) => observeStreamSpan(request, Stream.fromIterable(events))

const spanLines = (lines: Array<Record<string, unknown>>) => {
  const byName = (name: string) => lines.find((line) => line.name === name)
  return { byName, names: lines.map((line) => line.name) }
}

describe("observeStreamSpan", () => {
  test("records llm.stream with first-token, streaming, and completion sub-stage spans", async () => {
    const lines: Array<Record<string, unknown>> = []
    await runSpan(
      Effect.withSpan("turn", { kind: "internal" })(
        stream([
          LLMEvent.textDelta({ id: "block_1", text: "Hi" }),
          LLMEvent.finish({ reason: "stop", usage: { inputTokens: 5, outputTokens: 3 } }),
        ]).pipe(Stream.runCollect),
      ),
      lines,
    )

    const { byName, names } = spanLines(lines)
    expect(names.sort()).toEqual(["llm.completion", "llm.first-token", "llm.stream", "llm.streaming", "turn"])
    const turn = byName("turn")
    const root = byName("llm.stream")
    const firstToken = byName("llm.first-token")
    const streaming = byName("llm.streaming")
    const completion = byName("llm.completion")
    expect(root?.parentSpanId).toBe(turn?.spanId)
    expect(firstToken?.parentSpanId).toBe(root?.spanId)
    expect(streaming?.parentSpanId).toBe(root?.spanId)
    expect(completion?.parentSpanId).toBe(root?.spanId)
    expect(firstToken?.traceId).toBe(root?.traceId)
    expect(streaming?.traceId).toBe(root?.traceId)
    expect(completion?.traceId).toBe(root?.traceId)
    expect(completion?.attributes).toMatchObject({ tokensInput: 5, tokensOutput: 3 })
    expect(completion?.exit).toEqual({ _tag: "Success" })
    expect(firstToken?.exit).toEqual({ _tag: "Success" })
    expect(streaming?.exit).toEqual({ _tag: "Success" })
    expect(root?.attributes).toMatchObject({ provider: "fake", route: "openai-chat", model: "fake-model" })
  })

  test("ends completion with a failure exit on provider error", async () => {
    const lines: Array<Record<string, unknown>> = []
    await runSpan(
      Effect.withSpan("turn", { kind: "internal" })(
        stream([LLMEvent.providerError({ message: "upstream exploded" })]).pipe(Stream.runCollect),
      ),
      lines,
    )

    const completion = lines.find((line) => line.name === "llm.completion")
    expect(completion?.exit).toEqual({ _tag: "Failure", cause: `Cause([Fail("upstream exploded")])` })
    expect(lines.find((line) => line.name === "llm.first-token")?.exit).toEqual({
      _tag: "Failure",
      cause: `Cause([Fail("stream ended before completion")])`,
    })
  })

  test("attaches sub-stage spans to the llm.stream root without an outer parent", async () => {
    const lines: Array<Record<string, unknown>> = []
    await runSpan(
      stream([
        LLMEvent.textDelta({ id: "block_1", text: "Hi" }),
        LLMEvent.finish({ reason: "stop" }),
      ]).pipe(Stream.runCollect),
      lines,
    )

    const { byName, names } = spanLines(lines)
    expect(names.sort()).toEqual(["llm.completion", "llm.first-token", "llm.stream", "llm.streaming"])
    const root = byName("llm.stream")
    expect(byName("llm.first-token")?.parentSpanId).toBe(root?.spanId)
    expect(byName("llm.streaming")?.parentSpanId).toBe(root?.spanId)
    expect(byName("llm.completion")?.parentSpanId).toBe(root?.spanId)
  })
})

describe("observeStream metrics", () => {
  test("records tokens, first-token, streaming, and duration metrics on finish", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "obs-llm-"))
    const obs = makeObservability(dir, { ...defaultRunContext, level: "debug", sampling: 1 })

    Effect.runSync(
      observeStream(request, obs)(
        Stream.fromIterable([
          LLMEvent.textDelta({ id: "block_1", text: "Hi" }),
          LLMEvent.finish({ reason: "stop", usage: { inputTokens: 5, outputTokens: 3 } }),
        ]),
      ).pipe(Stream.runCollect),
    )

    const labels = "model=fake-model,provider=fake"
    expect(obs.snapshot().counters).toMatchObject({
      [`llm.tokens.input{${labels}}`]: 5,
      [`llm.tokens.output{${labels}}`]: 3,
      [`llm.tokens.total{${labels}}`]: 8,
    })
    expect(Object.keys(obs.snapshot().timers).sort()).toEqual([
      `llm.duration{${labels}}`,
      `llm.first-token{${labels}}`,
      `llm.streaming{${labels}}`,
    ])
    expect(obs.snapshot().timers[`llm.duration{${labels}}`]?.count).toBe(1)
  })

  test("records an error counter on provider error", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "obs-llm-"))
    const obs = makeObservability(dir, { ...defaultRunContext, level: "debug", sampling: 1 })

    Effect.runSync(
      observeStream(request, obs)(Stream.fromIterable([LLMEvent.providerError({ message: "boom" })])).pipe(
        Stream.runCollect,
      ),
    )

    expect(obs.snapshot().counters[`llm.errors{model=fake-model,provider=fake}`]).toBe(1)
  })
})
