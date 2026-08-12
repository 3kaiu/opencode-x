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
import type { Exporter } from "./exporter"
import { LocalExporter } from "./exporter"

export interface ObservabilityInterface extends MetricsSink {
  readonly log: (entry: Omit<LogEntry, "service">) => void
  readonly span: (span: Record<string, unknown>) => void
  readonly event: (name: string, labels?: Record<string, string>) => void
  readonly diagnostics: Diagnostics
  readonly profiler: Profiler
  readonly storage: Storage
  readonly exporter: Exporter
  readonly config: Config
  readonly snapshot: () => MetricSnapshot
}

export class Observability extends Context.Service<Observability, ObservabilityInterface>()(
  "@opencode/Observability",
) {}

/**
 * The effective runtime context merges the caller-provided RunContext with the
 * env-loaded config (spec: §6.5). An explicitly provided (non-default) context
 * wins so tests keep deterministic control; otherwise the config is
 * authoritative and `OPENCODE_LOG_LEVEL` / sampling envs apply in production.
 */
function effectiveContext(config: Config, runContext: RunContext): RunContext {
  if (runContext !== defaultRunContext) return runContext
  return {
    level: config.level,
    sampling: config.sampling,
    profiling: config.profiling,
  }
}

export const makeObservability = (logDir: string, runContext: RunContext): ObservabilityInterface => {
  const config = loadConfig(process.env, logDir)
  const context = effectiveContext(config, runContext)
  const storage = makeStorage(config)
  const exporter = LocalExporter(storage)
  const metrics = makeMetricsSink()
  const diagnostics = makeDiagnostics(metrics)
  const profiler = makeProfiler(config.profiling, metrics)
  if (Object.values(config.profiling).some(Boolean)) profiler.start()

  const log = (entry: Omit<LogEntry, "service">) => {
    if (!config.enabled) return
    if (!allowed(entry, context)) return
    if (entry.level === "TRACE" || entry.level === "DEBUG") {
      if (!shouldSample(context, entry.traceId)) return
    }
    const full: LogEntry = { ...entry, service: SERVICE_NAME }
    exporter.exportRecord({ category: CATEGORY_RUNTIME, line: entryToString(full) })
  }

  const span = (span: Record<string, unknown>) => {
    if (!config.enabled) return
    const salt = String(span.traceId ?? span.id ?? span.name ?? "span")
    if (!shouldSample(context, salt)) return
    exporter.exportRecord({ category: CATEGORY_PERFORMANCE, line: JSON.stringify(span) })
  }

  const record: MetricsSink["record"] = (kind, name, labels, value) => {
    if (!config.enabled) return
    if ((kind === "timer" || kind === "histogram") && !shouldSample(context, name)) return
    metrics.record(kind, name, labels, value)
  }

  return {
    ...metrics,
    log,
    span,
    record,
    event: (name, labels = {}) => {
      metrics.record("counter", name, labels, 1)
    },
    diagnostics,
    profiler,
    storage,
    exporter,
    config,
    snapshot: () => metrics.snapshot(),
  }
}

export const ObservabilityLayer = (logDir: string, runContext: RunContext) =>
  Layer.succeed(Observability, makeObservability(logDir, runContext))

export const ObservabilityRunContextLayer = Layer.succeed(RunContext, defaultRunContext)
