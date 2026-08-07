import { Schema } from "effect"
import { DEFAULT_SAMPLING_PRODUCTION } from "./constants"

export const Mode = Schema.Literals(["production", "debug", "profiling"])
export type Mode = Schema.Schema.Type<typeof Mode>

export const ProfilingSwitches = Schema.Struct({
  cpu: Schema.Boolean,
  memory: Schema.Boolean,
  latency: Schema.Boolean,
  token: Schema.Boolean,
  io: Schema.Boolean,
  network: Schema.Boolean,
  storage: Schema.Boolean,
  queue: Schema.Boolean,
})
export type ProfilingSwitches = Schema.Schema.Type<typeof ProfilingSwitches>

export const Config = Schema.Struct({
  level: Mode,
  enabled: Schema.Boolean,
  sampling: Schema.Number,
  storage: Schema.Literal("local"),
  logDir: Schema.String,
  maxFileSizeBytes: Schema.Number,
  retentionDays: Schema.Number,
  maxTotalBytes: Schema.Number,
  profiling: ProfilingSwitches,
})
export type Config = Schema.Schema.Type<typeof Config>

export const defaultProfilingSwitches: ProfilingSwitches = {
  cpu: false,
  memory: false,
  latency: false,
  token: false,
  io: false,
  network: false,
  storage: false,
  queue: false,
}

export function samplingForMode(level: Mode): number {
  return level === "production" ? DEFAULT_SAMPLING_PRODUCTION : 1
}

export function defaultConfig(logDir: string): Config {
  return {
    level: "production",
    enabled: true,
    sampling: samplingForMode("production"),
    storage: "local",
    logDir,
    maxFileSizeBytes: 10 * 1024 * 1024,
    retentionDays: 7,
    maxTotalBytes: 500 * 1024 * 1024,
    profiling: defaultProfilingSwitches,
  }
}

export function loadConfig(env: NodeJS.ProcessEnv, logDir: string): Config {
  const base = defaultConfig(logDir)
  const value = env.OPENCODE_LOG_LEVEL?.toLowerCase()
  const level: Mode = value === "debug" || value === "profiling"
    ? value
    : env.OPENCODE_PRINT_LOGS === "1"
      ? "debug"
      : base.level
  const traceFile = env.OPENCODE_TRACE_FILE
  const profiling = traceFile === "1" || traceFile === "true"
    ? { ...base.profiling, cpu: true }
    : base.profiling
  return {
    ...base,
    level,
    sampling: samplingForMode(level),
    profiling,
    enabled: !(env.OPENCODE_OBSERVABILITY_DISABLED === "1"),
  }
}
