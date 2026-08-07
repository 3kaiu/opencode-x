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

  test("error spike past 60s window emits ERROR", () => {
    const sink = makeMetricsSink()
    const diag = makeDiagnostics(sink, { slowMultiplier: 10, slowAbsoluteMs: 3000, errorRateMultiplier: 2 })
    for (let i = 0; i < 12; i++) diag.record("tool.run", { tool: "bash" }, 10, i % 2 === 0)
    const events = diag.events()
    expect(events.some((e) => e.rule === "error-spike" && e.severity === "ERROR")).toBe(true)
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
})
