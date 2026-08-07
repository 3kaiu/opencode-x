import { Context, Layer } from "effect"
import { LogEntry } from "@opencode-ai/schema"
import type { Config } from "./config"
import { loadConfig } from "./config"
import { CATEGORY_PERFORMANCE, CATEGORY_RUNTIME, SERVICE_NAME } from "./constants"
import { RunContext, defaultRunContext, shouldSample } from "./context"
import { allowed, entryToString } from "./logger"
import type { Storage } from "./storage"
import { defaultLogDir, makeStorage } from "./storage"
import type { MetricsSink, MetricSnapshot } from "./metrics"
import { makeMetricsSink } from "./metrics"
import type { Diagnostics } from "./diagnostics"
import { makeDiagnostics } from "./diagnostics"
import type { Profiler } from "./profiler"
import { makeProfiler } from "./profiler"

export interface ObservabilityInterface extends MetricsSink {
  readonly log: (entry: Omit<LogEntry, "service">) => void
  readonly span: (span: Record<string, unknown>) => void
  readonly event: (name: string, labels?: Record<string, string>) => void
  readonly diagnostics: Diagnostics
  readonly profiler: Profiler
  readonly storage: Storage
  readonly config: Config
  readonly snapshot: () => MetricSnapshot
}

export class Observability extends Context.Service<Observability, ObservabilityInterface>()(
  "@opencode/Observability",
) {}

export const makeObservability = (logDir: string, runContext: RunContext): ObservabilityInterface => {
  const config = loadConfig(process.env, logDir)
  const storage = makeStorage(config)
  const metrics = makeMetricsSink()
  const diagnostics = makeDiagnostics(metrics)
  const profiler = makeProfiler(config.profiling, metrics)

  const log = (entry: Omit<LogEntry, "service">) => {
    if (!config.enabled) return
    if (!allowed(entry, runContext)) return
    if (entry.level === "TRACE" || entry.level === "DEBUG") {
      if (!shouldSample(runContext, entry.traceId)) return
    }
    const full: LogEntry = { ...entry, service: SERVICE_NAME }
    storage.append(CATEGORY_RUNTIME, entryToString(full))
  }

  return {
    ...metrics,
    log,
    span: (span) => {
      if (!config.profiling.cpu) return
      storage.append(CATEGORY_PERFORMANCE, JSON.stringify(span))
    },
    event: (name, labels = {}) => {
      metrics.record("counter", name, labels, 1)
    },
    diagnostics,
    profiler,
    storage,
    config,
    snapshot: () => metrics.snapshot(),
  }
}

export const ObservabilityLayer = (logDir: string, runContext: RunContext) =>
  Layer.succeed(Observability, makeObservability(logDir, runContext))

export const ObservabilityRunContextLayer = Layer.succeed(RunContext, defaultRunContext)
