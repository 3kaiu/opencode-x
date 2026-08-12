import { describe, expect, it } from "bun:test"
import type { CliRendererStats } from "@opentui/core"
import { Metrics } from "@opencode-ai/observability"
import {
  recordRenderSample,
  sampleRenderStats,
  startRenderObservability,
  type RenderSample,
} from "../../src/observability/render"

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function makeStats(overrides: Partial<CliRendererStats> = {}): CliRendererStats {
  return {
    fps: 60,
    frameCount: 0,
    frameTimes: [],
    averageFrameTime: 16,
    minFrameTime: 8,
    maxFrameTime: 42,
    frameCallbackTime: 0,
    nativeLastFrameTime: 0,
    nativeAverageFrameTime: 0,
    nativeFrameCount: 0,
    cellsUpdated: 0,
    averageCellsUpdated: 0,
    ...overrides,
  }
}

describe("sampleRenderStats", () => {
  it("maps CliRendererStats to a RenderSample", () => {
    const sample = sampleRenderStats(
      makeStats({ fps: 60, frameCount: 120, averageFrameTime: 16.5, minFrameTime: 8, maxFrameTime: 42, cellsUpdated: 2400 }),
    )
    expect(sample).toEqual({ fps: 60, frameCount: 120, averageFrameTime: 16.5, cellsUpdated: 2400 })
  })
})

describe("recordRenderSample", () => {
  it("records fps gauge, frameTime timer and counter deltas", () => {
    const sink = Metrics.makeMetricsSink()
    const first: RenderSample = { fps: 60, frameCount: 100, averageFrameTime: 16.5, cellsUpdated: 2400 }
    const second: RenderSample = { fps: 55, frameCount: 150, averageFrameTime: 18.2, cellsUpdated: 3600 }

    const prev = recordRenderSample(sink, first, undefined)
    expect(prev).toEqual(first)
    recordRenderSample(sink, second, prev)

    const snapshot = sink.snapshot()
    expect(snapshot.gauges["tui.render.fps"]).toBe(55)
    expect(snapshot.timers["tui.render.frameTime{unit=ms}"]).toEqual({
      count: 2,
      sum: 34.7,
      min: 16.5,
      max: 18.2,
      p50: 16.5,
      p95: 18.2,
    })
    expect(snapshot.counters["tui.render.frames"]).toBe(50)
    expect(snapshot.counters["tui.render.cells"]).toBe(1200)
  })

  it("skips zero counters", () => {
    const sink = Metrics.makeMetricsSink()
    const first: RenderSample = { fps: 60, frameCount: 100, averageFrameTime: 16, cellsUpdated: 100 }
    const prev = recordRenderSample(sink, first, undefined)
    const frozen: RenderSample = { fps: 60, frameCount: 100, averageFrameTime: 16, cellsUpdated: 100 }
    recordRenderSample(sink, frozen, prev)

    const snapshot = sink.snapshot()
    expect(snapshot.counters["tui.render.frames"]).toBeUndefined()
    expect(snapshot.counters["tui.render.cells"]).toBeUndefined()
  })
})

describe("startRenderObservability", () => {
  it("samples on an interval and reports via onSample", async () => {
    const sink = Metrics.makeMetricsSink()
    const samples: RenderSample[] = []
    let frameCount = 0
    const stop = startRenderObservability({
      getStats: () => {
        frameCount++
        return makeStats({ fps: 60, frameCount: frameCount * 10, averageFrameTime: 16, cellsUpdated: 100 })
      },
      observability: sink,
      intervalMs: 10,
      onSample: (sample) => samples.push(sample),
    })

    await wait(40)
    stop()

    expect(samples.length).toBeGreaterThan(0)
    const snapshot = sink.snapshot()
    expect(snapshot.gauges["tui.render.fps"]).toBe(60)
  })

  it("stops after stop() is called", async () => {
    let frameCount = 0
    const stop = startRenderObservability({
      getStats: () => {
        frameCount++
        return makeStats({ fps: 60, frameCount, averageFrameTime: 16, cellsUpdated: 0 })
      },
      observability: undefined,
      intervalMs: 5,
    })

    await wait(20)
    stop()
    const after = frameCount
    await wait(20)
    expect(frameCount).toBe(after)
  })

  it("tolerates a failing getStats", async () => {
    const sink = Metrics.makeMetricsSink()
    let calls = 0
    const stop = startRenderObservability({
      getStats: () => {
        calls++
        if (calls === 1) throw new Error("boom")
        return makeStats({ fps: 60, frameCount: 1, averageFrameTime: 16, cellsUpdated: 0 })
      },
      observability: sink,
      intervalMs: 10,
    })

    await wait(30)
    stop()

    expect(sink.snapshot().gauges["tui.render.fps"]).toBe(60)
  })

  it("tolerates getStats returning undefined", async () => {
    const stop = startRenderObservability({
      getStats: () => undefined,
      observability: undefined,
      intervalMs: 5,
    })
    await wait(15)
    stop()
    expect(true).toBe(true)
  })
})