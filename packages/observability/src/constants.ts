export const SERVICE_NAME = "opencode-x" as const

export const LOG_LEVELS = ["TRACE", "DEBUG", "INFO", "WARN", "ERROR", "FATAL"] as const
export type LogLevel = (typeof LOG_LEVELS)[number]

export const LOG_STATUSES = ["success", "failure", "blocked", "canceled"] as const

export const STORAGE_CATEGORIES = ["runtime", "package", "workflow", "tool", "llm", "error", "performance"] as const
export type StorageCategory = (typeof STORAGE_CATEGORIES)[number]

export const CATEGORY_RUNTIME = "runtime"
export const CATEGORY_PERFORMANCE = "performance"

export const DEFAULT_LOG_DIR = ".local/share/opencode/log"
export const DEFAULT_SAMPLING_PRODUCTION = 0.1

export const SLOW_MULTIPLIER = 10
export const SLOW_ABSOLUTE_MS = 3000
export const ERROR_RATE_MULTIPLIER = 2
export const ERROR_SPIKE_MIN_SAMPLES = 10
export const ERROR_SPIKE_THRESHOLD = 3
