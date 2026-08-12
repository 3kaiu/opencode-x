import { describe, expect, test } from "bun:test"
import { makeMetricsSink } from "../src/metrics"
import { makeDiagnostics } from "../src/diagnostics"
import { makeProfiler } from "../src/profiler"
import { defaultProfilingSwitches } from "../src/config"

describe("metrics", () => {
  test("counter accumulates", () => {
    const sink = makeMetricsSink()
    sink.record("counter", "tool.call", { tool: "bash" }, 1)
    sink.record("counter", "tool.call", { tool: "bash" }, 1)
    sink.record("counter", "tool.call", { tool: "read" }, 1)
    expect(sink.snapshot().counters).toEqual({
      "tool.call{tool=bash}": 2,
      "tool.call{tool=read}": 1,
    })
  })

  test("timer computes percentiles", () => {
    const sink = makeMetricsSink()
    for (const v of [10, 20, 30, 40, 50]) sink.record("timer", "llm.latency", { provider: "x" }, v)
    const timer = sink.snapshot().timers["llm.latency{provider=x}"]
    expect(timer).toBeDefined()
    expect(timer?.count).toBe(5)
    expect(timer?.p50).toBe(30)
    expect(timer?.p95).toBe(50)
  })

  test("gauge holds latest value", () => {
    const sink = makeMetricsSink()
    sink.record("gauge", "queue.length", {}, 3)
    sink.record("gauge", "queue.length", {}, 5)
    expect(sink.snapshot().gauges["queue.length"]).toBe(5)
  })
})

describe("diagnostics", () => {
  test("slow call above absolute threshold emits performance warning", () => {
    const sink = makeMetricsSink()
    const diag = makeDiagnostics(sink, { slowMultiplier: 10, slowAbsoluteMs: 3000, errorRateMultiplier: 2 })
    diag.record("llm.call", { provider: "x" }, 3500, true)
    const events = diag.events()
    expect(events.some((e) => e.rule === "slow-call" && e.target === "llm.call{provider=x}")).toBe(true)
    expect(sink.snapshot().counters["diagnostics.slow{kind=llm.call{provider=x}}"]).toBe(1)
  })

  test("consecutive failures past threshold emit ERROR", () => {
    const sink = makeMetricsSink()
    const diag = makeDiagnostics(sink, { slowMultiplier: 10, slowAbsoluteMs: 3000, errorRateMultiplier: 2 })
    for (let i = 0; i < 4; i++) diag.record("tool.run", { tool: "bash" }, 10, false)
    const events = diag.events()
    expect(events.some((e) => e.rule === "error-spike" && e.severity === "ERROR")).toBe(true)
  })

  test("error rate above 2x baseline emits WARN spike", () => {
    const sink = makeMetricsSink()
    let clock = 1_700_000_000_000
    const diag = makeDiagnostics(sink, { slowMultiplier: 10, slowAbsoluteMs: 3000, errorRateMultiplier: 2 }, () => clock)
    for (let i = 0; i < 20; i++) diag.record("tool.run", { tool: "read" }, 10, true)
    clock += 61_000
    for (let i = 0; i < 10; i++) diag.record("tool.run", { tool: "read" }, 10, false)
    const events = diag.events()
    const spike = events.find((e) => e.rule === "error-spike" && e.severity === "WARN")
    expect(spike).toBeDefined()
    expect(spike?.message).toContain("vs baseline")
  })

  test("regression against previous day baseline emits WARN", () => {
    const sink = makeMetricsSink()
    const day = 86400000
    const past = 1_700_000_000_000
    let clock = past
    const diag = makeDiagnostics(sink, { slowMultiplier: 10, slowAbsoluteMs: 3000, errorRateMultiplier: 2 }, () => clock)
    for (let i = 0; i < 10; i++) diag.record("llm.call", { provider: "x" }, 10, true)
    clock = past + 1
    for (let i = 0; i < 10; i++) diag.record("llm.call", { provider: "x" }, 10, true)
    clock = past + day
    for (let i = 0; i < 10; i++) diag.record("llm.call", { provider: "x" }, 100, true)
    const events = diag.events()
    expect(events.some((e) => e.rule === "regression")).toBe(true)
  })
})

describe("profiler", () => {
  test("inactive profiler records nothing and can start/stop", () => {
    const sink = makeMetricsSink()
    const profiler = makeProfiler(defaultProfilingSwitches, sink)
    profiler.sampler("memory").sample()
    profiler.start()
    profiler.stop()
    expect(profiler.active.size).toBe(0)
  })

  test("enabled cpu profiler samples gauges", () => {
    const sink = makeMetricsSink()
    const profiler = makeProfiler({ ...defaultProfilingSwitches, cpu: true }, sink)
    profiler.sampler("cpu").start()
    profiler.sampler("cpu").sample()
    const gauges = sink.snapshot().gauges
    expect(Object.keys(gauges).some((k) => k.startsWith("profiler.cpu"))).toBe(true)
  })

  test("latency sampler records event-loop lag", () => {
    const sink = makeMetricsSink()
    const profiler = makeProfiler({ ...defaultProfilingSwitches, latency: true }, sink)
    profiler.sampler("latency").start()
    profiler.sampler("latency").sample()
    const gauges = sink.snapshot().gauges
    expect(typeof gauges["profiler.latency.eventloop{unit=ms}"]).toBe("number")
  })

  test("token sampler derives rate from llm counters", () => {
    const sink = makeMetricsSink()
    sink.record("counter", "llm.tokens.input", { provider: "x" }, 100)
    sink.record("counter", "llm.tokens.output", { provider: "x" }, 50)
    const profiler = makeProfiler({ ...defaultProfilingSwitches, token: true }, sink)
    profiler.sampler("token").sample()
    sink.record("counter", "llm.tokens.input", { provider: "x" }, 20)
    sink.record("counter", "llm.tokens.output", { provider: "x" }, 10)
    profiler.sampler("token").sample()
    const gauges = sink.snapshot().gauges
    expect(gauges["profiler.token.input.rate{unit=tokens/s}"]).toBe(20)
    expect(gauges["profiler.token.output.rate{unit=tokens/s}"]).toBe(10)
  })

  test("source-backed samplers record registered probes only", () => {
    const sink = makeMetricsSink()
    const profiler = makeProfiler({ ...defaultProfilingSwitches, queue: true, network: true }, sink)
    profiler.sampler("queue").sample()
    profiler.registerSource("queue", () => 7)
    profiler.sampler("queue").sample()
    profiler.sampler("network").sample()
    expect(sink.snapshot().gauges["profiler.queue"]).toBe(7)
    expect(sink.snapshot().gauges["profiler.network"]).toBeUndefined()
  })
})
