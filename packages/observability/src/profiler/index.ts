import type { ProfilingSwitches } from "../config"
import type { Labels, MetricsSink } from "../metrics"

export type SampleKind = "cpu" | "memory" | "latency" | "token" | "io" | "network" | "storage" | "queue"

export interface Sampler {
  readonly kind: SampleKind
  readonly start: () => void
  readonly stop: () => void
  readonly sample: () => void
}

export interface Profiler {
  readonly active: Set<SampleKind>
  readonly sampler: (kind: SampleKind) => Sampler
  readonly start: () => void
  readonly stop: () => void
  readonly registerSource: (kind: SampleKind, probe: () => number | undefined) => void
}

const SAMPLE_PERIOD_MS = 1000

function aggregateCounters(sink: MetricsSink, base: string): number {
  const counters = sink.snapshot().counters
  let total = 0
  for (const [key, value] of Object.entries(counters)) {
    if (key === base || key.startsWith(`${base}{`)) total += value
  }
  return total
}

export function makeProfiler(switches: ProfilingSwitches, sink: MetricsSink): Profiler {
  const active = new Set<SampleKind>()
  const samplers = new Map<SampleKind, Sampler>()
  const sources = new Map<SampleKind, () => number | undefined>()
  let timer: ReturnType<typeof setInterval> | undefined
  let cpuBase: NodeJS.CpuUsage | undefined

  function register(kind: SampleKind, make: Partial<Sampler>) {
    samplers.set(kind, {
      kind,
      start: make.start ?? (() => {}),
      stop: make.stop ?? (() => {}),
      sample: make.sample ?? (() => {}),
    })
  }

  register("cpu", {
    start: () => {
      cpuBase = process.cpuUsage()
    },
    sample: () => {
      if (!cpuBase) return
      const usage = process.cpuUsage(cpuBase)
      sink.record("gauge", "profiler.cpu", { core: "process" }, (usage.user + usage.system) / 1000)
    },
  })

  register("memory", {
    sample: () => {
      const current = process.memoryUsage()
      sink.record("gauge", "profiler.memory.heap", { unit: "bytes" }, current.heapUsed)
      sink.record("gauge", "profiler.memory.rss", { unit: "bytes" }, current.rss)
      sink.record("gauge", "profiler.memory.external", { unit: "bytes" }, current.external)
    },
  })

  let latencyNext = 0
  register("latency", {
    start: () => {
      latencyNext = Date.now() + SAMPLE_PERIOD_MS
    },
    sample: () => {
      const lag = Math.max(0, Date.now() - latencyNext)
      latencyNext = Date.now() + SAMPLE_PERIOD_MS
      sink.record("gauge", "profiler.latency.eventloop", { unit: "ms" }, lag)
    },
  })

  let tokenInputPrev = -1
  let tokenOutputPrev = -1
  register("token", {
    sample: () => {
      const input = aggregateCounters(sink, "llm.tokens.input")
      const output = aggregateCounters(sink, "llm.tokens.output")
      if (tokenInputPrev >= 0) sink.record("gauge", "profiler.token.input.rate", { unit: "tokens/s" }, input - tokenInputPrev)
      if (tokenOutputPrev >= 0) sink.record("gauge", "profiler.token.output.rate", { unit: "tokens/s" }, output - tokenOutputPrev)
      tokenInputPrev = input
      tokenOutputPrev = output
    },
  })

  let ioPrev: number | undefined
  function ioBytes(): number | undefined {
    if (typeof process.resourceUsage !== "function") return undefined
    const usage = process.resourceUsage()
    return usage.fsRead + usage.fsWrite
  }
  register("io", {
    start: () => {
      ioPrev = ioBytes()
    },
    sample: () => {
      const current = ioBytes()
      if (current === undefined || ioPrev === undefined) return
      sink.record("gauge", "profiler.io.rate", { unit: "bytes/s" }, Math.max(0, current - ioPrev))
      ioPrev = current
    },
  })

  for (const kind of ["network", "storage", "queue"] as const) {
    register(kind, {
      sample: () => {
        const probe = sources.get(kind)
        if (!probe) return
        const value = probe()
        if (value !== undefined) sink.record("gauge", `profiler.${kind}`, {}, value)
      },
    })
  }

  function build(kind: SampleKind): Sampler {
    const base = samplers.get(kind)
    if (!base) throw new Error(`unknown sampler: ${kind}`)
    const wrapped = { ...base }
    const original = base.sample.bind(base)
    wrapped.sample = () => {
      if (active.has(kind)) original()
    }
    return wrapped
  }

  function refresh() {
    active.clear()
    for (const [kind, value] of Object.entries(switches)) {
      if (value) active.add(kind as SampleKind)
    }
  }

  function start() {
    refresh()
    for (const kind of active) samplers.get(kind)?.start()
    timer = setInterval(() => {
      for (const kind of active) samplers.get(kind)?.sample()
    }, SAMPLE_PERIOD_MS)
    if (typeof timer.unref === "function") timer.unref()
  }

  function stop() {
    if (timer) clearInterval(timer)
    timer = undefined
  }

  refresh()
  return {
    active,
    sampler: build,
    start,
    stop,
    registerSource: (kind, probe) => {
      sources.set(kind, probe)
    },
  }
}