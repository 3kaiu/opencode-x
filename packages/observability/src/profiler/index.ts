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
}

export function makeProfiler(switches: ProfilingSwitches, sink: MetricsSink): Profiler {
  const active = new Set<SampleKind>()
  const samplers = new Map<SampleKind, Sampler>()
  let timer: ReturnType<typeof setInterval> | undefined
  let cpuBase: NodeJS.CpuUsage | undefined
  const memory = process.memoryUsage()

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

  register("latency", {
    sample: () => {
      const t = process.hrtime.bigint()
      sink.record("timer", "profiler.latency.eventloop", { probe: "hrtime" }, Number(t) % 1000)
    },
  })

  for (const kind of ["token", "io", "network", "storage", "queue"] as const) {
    register(kind, { sample: () => {} })
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
    }, 1000)
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
  }
}
