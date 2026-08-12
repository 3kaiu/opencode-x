import type { CliRendererStats } from "@opentui/core"
import { type Metrics } from "@opencode-ai/observability"

export interface RenderSample {
  readonly fps: number
  readonly frameCount: number
  readonly averageFrameTime: number
  readonly cellsUpdated: number
}

export function sampleRenderStats(stats: CliRendererStats): RenderSample {
  return {
    fps: stats.fps,
    frameCount: stats.frameCount,
    averageFrameTime: stats.averageFrameTime ?? 0,
    cellsUpdated: stats.cellsUpdated ?? 0,
  }
}

export function recordRenderSample(
  observability: Metrics.MetricsSink,
  sample: RenderSample,
  previous: RenderSample | undefined,
): RenderSample {
  observability.record("gauge", "tui.render.fps", {}, sample.fps)
  observability.record("timer", "tui.render.frameTime", { unit: "ms" }, sample.averageFrameTime)
  if (previous) {
    const frames = sample.frameCount - previous.frameCount
    if (frames > 0) observability.record("counter", "tui.render.frames", {}, frames)
    const cells = sample.cellsUpdated - previous.cellsUpdated
    if (cells > 0) observability.record("counter", "tui.render.cells", {}, cells)
  }
  return sample
}

export interface RenderObservabilityOptions {
  readonly getStats: () => CliRendererStats | undefined
  readonly observability?: Metrics.MetricsSink
  readonly intervalMs?: number
  readonly onSample?: (sample: RenderSample) => void
}

export function startRenderObservability(options: RenderObservabilityOptions): () => void {
  const intervalMs = options.intervalMs ?? 5000
  let previous: RenderSample | undefined
  const timer = setInterval(() => {
    try {
      const stats = options.getStats()
      if (!stats) return
      const sample = sampleRenderStats(stats)
      options.onSample?.(sample)
      if (options.observability) {
        previous = recordRenderSample(options.observability, sample, previous)
      }
    } catch {
      // never let render observability break the UI
    }
  }, intervalMs)
  if (typeof timer.unref === "function") timer.unref()
  return () => clearInterval(timer)
}