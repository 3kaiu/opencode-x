export type Labels = Record<string, string>

interface Metric {
  readonly name: string
  readonly labels: Labels
  readonly samples: number[]
  readonly timestamps: number[]
  readonly kind: "counter" | "timer" | "histogram" | "gauge"
}

export interface MetricsSink {
  readonly record: (kind: Metric["kind"], name: string, labels: Labels, value: number) => void
  readonly snapshot: () => MetricSnapshot
}

export interface MetricSnapshot {
  readonly counters: Record<string, number>
  readonly timers: Record<string, { count: number; sum: number; min: number; max: number; p50: number; p95: number }>
  readonly histograms: Record<string, Record<number, number>>
  readonly gauges: Record<string, number>
}

function keyOf(name: string, labels: Labels): string {
  const keys = Object.keys(labels)
  if (keys.length === 0) return name
  if (keys.length === 1) return `${name}{${keys[0]}=${labels[keys[0]]}}`
  const suffix = keys.sort((a, b) => a.localeCompare(b)).map((key) => `${key}=${labels[key]}`).join(",")
  return `${name}{${suffix}}`
}

export function makeMetricsSink(windowSize = 10_000): MetricsSink {
  const counters = new Map<string, number>()
  const gauges = new Map<string, number>()
  const timers = new Map<string, number[]>()
  const histograms = new Map<string, Map<number, number>>()

  function boundedPush(bucket: number[], value: number) {
    bucket.push(value)
    if (bucket.length >= windowSize + 1024) bucket.splice(0, bucket.length - windowSize)
  }

  function record(kind: Metric["kind"], name: string, labels: Labels, value: number) {
    const k = keyOf(name, labels)
    if (kind === "counter") counters.set(k, (counters.get(k) ?? 0) + value)
    else if (kind === "gauge") gauges.set(k, value)
    else if (kind === "timer") {
      const bucket = timers.get(k) ?? []
      boundedPush(bucket, value)
      timers.set(k, bucket)
    } else {
      const bucket = histograms.get(k) ?? new Map<number, number>()
      bucket.set(value, (bucket.get(value) ?? 0) + 1)
      if (bucket.size > windowSize) {
        const oldest = bucket.keys().next().value
        if (oldest !== undefined) bucket.delete(oldest)
      }
      histograms.set(k, bucket)
    }
  }

  function percentile(sorted: number[], p: number): number {
    if (sorted.length === 0) return 0
    const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)
    return sorted[index] ?? 0
  }

  function snapshot(): MetricSnapshot {
    const t: MetricSnapshot["timers"] = {}
    for (const [k, values] of timers) {
      const sorted = [...values].sort((a, b) => a - b)
      t[k] = {
        count: values.length,
        sum: values.reduce((a, b) => a + b, 0),
        min: sorted[0] ?? 0,
        max: sorted[sorted.length - 1] ?? 0,
        p50: percentile(sorted, 50),
        p95: percentile(sorted, 95),
      }
    }
    const h: MetricSnapshot["histograms"] = {}
    for (const [k, bucket] of histograms) h[k] = Object.fromEntries(bucket)
    const c: Record<string, number> = {}
    for (const [k, v] of counters) c[k] = v
    const g: Record<string, number> = {}
    for (const [k, v] of gauges) g[k] = v
    return { counters: c, timers: t, histograms: h, gauges: g }
  }

  return { record, snapshot }
}
