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

const REGRESSION_WINDOW_DAYS = 7
const ERROR_WINDOW_MS = 60_000

interface DayBucket {
  readonly count: number
  readonly sum: number
}

interface RecentState {
  total: number
  errors: number
  consecutiveErrors: number
}

function dayStamp(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10)
}

export function makeDiagnostics(sink: MetricsSink, thresholds: Thresholds = defaultThresholds, now: () => number = Date.now): Diagnostics {
  const baselines = new Map<string, Baseline>()
  const events: DiagnosticEvent[] = []
  const recent = new Map<string, RecentState>()
  const window: Array<{ kind: string; ok: boolean; ts: number }> = []
  const days = new Map<string, Map<string, DayBucket>>()
  const regressionReported = new Set<string>()

  function key(kind: string, labels: Labels): string {
    const suffix = Object.entries(labels).sort(([a], [b]) => a.localeCompare(b))
    return suffix.length ? `${kind}{${suffix.map(([k, v]) => `${k}=${v}`).join(",")}}` : kind
  }

  function emit(rule: DiagnosticEvent["rule"], target: string, severity: DiagnosticEvent["severity"], message: string) {
    events.push({ rule, target, severity, message, timestamp: now() })
  }

  function record(kind: string, labels: Labels, durationMs: number, ok: boolean) {
    const k = key(kind, labels)
    const ts = now()
    const previous = baselines.get(k)
    const avgMs = previous === undefined
      ? durationMs
      : (previous.avgMs * previous.count + durationMs) / (previous.count + 1)
    baselines.set(k, { kind, avgMs, count: (previous?.count ?? 0) + 1 })

    const state = recent.get(k) ?? { total: 0, errors: 0, consecutiveErrors: 0 }
    state.total += 1
    state.consecutiveErrors = ok ? 0 : state.consecutiveErrors + 1
    if (!ok) state.errors += 1
    recent.set(k, state)
    window.push({ kind: k, ok, ts })

    if (durationMs >= thresholds.slowAbsoluteMs || durationMs >= avgMs * thresholds.slowMultiplier) {
      emit("slow-call", k, "WARN", `slow call ${k}: ${durationMs}ms vs baseline ${avgMs.toFixed(1)}ms`)
      sink.record("counter", "diagnostics.slow", { kind: k }, 1)
    }

    const trimmed = window.filter((w) => ts - w.ts < ERROR_WINDOW_MS)
    window.length = 0
    for (const w of trimmed) window.push(w)
    const recentFor = trimmed.filter((w) => w.kind === k)
    if (recentFor.length >= ERROR_SPIKE_MIN_SAMPLES) {
      const windowErrors = recentFor.filter((w) => !w.ok).length
      const windowRate = windowErrors / recentFor.length
      const baselineRate = state.total === 0 ? 0 : state.errors / state.total
      if (windowRate >= thresholds.errorRateMultiplier * Math.max(baselineRate, 0.05)) {
        emit("error-spike", k, "WARN", `error rate spike ${k}: ${windowErrors}/${recentFor.length} in last 60s vs baseline ${(baselineRate * 100).toFixed(1)}%`)
        sink.record("counter", "diagnostics.error-spike", { kind: k }, 1)
      }
    }
    if (state.consecutiveErrors >= ERROR_SPIKE_THRESHOLD) {
      emit("error-spike", k, "ERROR", `consecutive failures ${k}: ${state.consecutiveErrors} in a row`)
      sink.record("counter", "diagnostics.error-spike", { kind: k, consecutive: "true" }, 1)
    }

    const day = dayStamp(ts)
    const buckets = days.get(k) ?? new Map<string, DayBucket>()
    const bucket = buckets.get(day)
    buckets.set(day, { count: (bucket?.count ?? 0) + 1, sum: (bucket?.sum ?? 0) + durationMs })
    days.set(k, buckets)

    if (day !== dayStamp(ts - 86400000)) {
      const prevDay = dayStamp(ts - 86400000)
      const prev = buckets.get(prevDay)
      const today = buckets.get(day)
      const marker = `${k}:${day}`
      if (
        prev !== undefined && today !== undefined &&
        prev.count >= ERROR_SPIKE_MIN_SAMPLES && today.count >= ERROR_SPIKE_MIN_SAMPLES &&
        !regressionReported.has(marker)
      ) {
        const prevAvg = prev.sum / prev.count
        const todayAvg = today.sum / today.count
        if (todayAvg >= 2 * Math.max(prevAvg, 1)) {
          regressionReported.add(marker)
          emit("regression", k, "WARN", `performance regression ${k}: today avg ${todayAvg.toFixed(1)}ms vs prev day ${prevAvg.toFixed(1)}ms`)
          sink.record("counter", "diagnostics.regression", { kind: k }, 1)
        }
      }
    }

    const cutoff = dayStamp(ts - REGRESSION_WINDOW_DAYS * 86400000)
    for (const [k2, buckets2] of days) {
      for (const day2 of buckets2.keys()) {
        if (day2 < cutoff) buckets2.delete(day2)
      }
      if (buckets2.size === 0) days.delete(k2)
    }

    sink.record("timer", "diagnostics.duration", { kind: k }, durationMs)
    sink.record("counter", "diagnostics.calls", { kind: k }, 1)
  }

  return { record, baselines: () => baselines, events: () => events, thresholds }
}