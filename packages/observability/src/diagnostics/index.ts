import type { Labels, MetricsSink } from "../metrics"
import { ERROR_RATE_MULTIPLIER, ERROR_SPIKE_MIN_SAMPLES, ERROR_SPIKE_THRESHOLD, SLOW_ABSOLUTE_MS, SLOW_MULTIPLIER } from "../constants"

export interface Baseline {
  readonly kind: string
  readonly avgMs: number
  readonly count: number
}

export interface Thresholds {
  readonly slowMultiplier: number
  readonly slowAbsoluteMs: number
  readonly errorRateMultiplier: number
}

export interface DiagnosticEvent {
  readonly rule: "slow-call" | "error-spike" | "regression"
  readonly target: string
  readonly severity: "WARN" | "ERROR"
  readonly message: string
  readonly timestamp: number
}

export interface Diagnostics {
  readonly record: (kind: string, labels: Labels, durationMs: number, ok: boolean) => void
  readonly baselines: () => Map<string, Baseline>
  readonly events: () => DiagnosticEvent[]
  readonly thresholds: Thresholds
}

const defaultThresholds: Thresholds = {
  slowMultiplier: SLOW_MULTIPLIER,
  slowAbsoluteMs: SLOW_ABSOLUTE_MS,
  errorRateMultiplier: ERROR_RATE_MULTIPLIER,
}

export function makeDiagnostics(sink: MetricsSink, thresholds: Thresholds = defaultThresholds): Diagnostics {
  const baselines = new Map<string, Baseline>()
  const events: DiagnosticEvent[] = []
  const recent = new Map<string, { total: number; errors: number }>()
  const window: Array<{ kind: string; durationMs: number; ok: boolean; ts: number }> = []

  function key(kind: string, labels: Labels): string {
    const suffix = Object.entries(labels).sort(([a], [b]) => a.localeCompare(b))
    return suffix.length ? `${kind}{${suffix.map(([k, v]) => `${k}=${v}`).join(",")}}` : kind
  }

  function record(kind: string, labels: Labels, durationMs: number, ok: boolean) {
    const k = key(kind, labels)
    const previous = baselines.get(k)
    const avgMs = previous === undefined
      ? durationMs
      : (previous.avgMs * previous.count + durationMs) / (previous.count + 1)
    baselines.set(k, { kind, avgMs, count: (previous?.count ?? 0) + 1 })

    const bucket = recent.get(k) ?? { total: 0, errors: 0 }
    recent.set(k, { total: bucket.total + 1, errors: bucket.errors + (ok ? 0 : 1) })
    window.push({ kind: k, durationMs, ok, ts: Date.now() })

    if (durationMs >= thresholds.slowAbsoluteMs || durationMs >= avgMs * thresholds.slowMultiplier) {
      events.push({
        rule: "slow-call",
        target: k,
        severity: "WARN",
        message: `slow call ${k}: ${durationMs}ms vs baseline ${avgMs.toFixed(1)}ms`,
        timestamp: Date.now(),
      })
      sink.record("counter", "diagnostics.slow", { kind: k }, 1)
    }

    const trimmed = window.filter((w) => Date.now() - w.ts < 60000)
    const recentFor = trimmed.filter((w) => w.kind === k)
    if (recentFor.length >= ERROR_SPIKE_MIN_SAMPLES) {
      const errors = recentFor.filter((w) => !w.ok).length
      if (errors >= ERROR_SPIKE_THRESHOLD) {
        events.push({
          rule: "error-spike",
          target: k,
          severity: "ERROR",
          message: `error spike ${k}: ${errors}/${recentFor.length} in last 60s`,
          timestamp: Date.now(),
        })
        sink.record("counter", "diagnostics.error-spike", { kind: k }, 1)
      }
    }

    sink.record("timer", "diagnostics.duration", { kind: k }, durationMs)
    sink.record("counter", "diagnostics.calls", { kind: k }, 1)
  }

  return { record, baselines: () => baselines, events: () => events, thresholds }
}
