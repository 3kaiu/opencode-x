import type { LogEntry } from "@opencode-ai/schema"
import { Formatter } from "effect"
import type { RunContext } from "../context"
import type { Config } from "../config"
import { LOG_LEVELS } from "../constants"

const levelRank: Record<LogEntry["level"], number> = Object.fromEntries(
  LOG_LEVELS.map((level, index) => [level, index]),
) as Record<LogEntry["level"], number>

export function minimumRank(level: Config["level"]): number {
  return level === "debug" ? 0 : level === "profiling" ? 0 : 3
}

export function allowed(entry: LogEntry | Omit<LogEntry, "service">, context: RunContext): boolean {
  if (levelRank[entry.level] < minimumRank(context.level)) return false
  if (entry.level === "TRACE" || entry.level === "DEBUG") {
    if (context.level !== "debug" && context.level !== "profiling") return false
  }
  return true
}

export function entryToString(entry: LogEntry | Omit<LogEntry, "service">): string {
  let out = ""
  for (const [key, value] of Object.entries(entry)) {
    if (out.length > 0) out += " "
    out += `${key}=${value === undefined || value === null ? "null" : format(value)}`
  }
  return out
}

function format(input: unknown) {
  const value = typeof input === "string" ? input : Formatter.format(input)
  return /^[^\s="\\]+$/.test(value) ? value : JSON.stringify(value)
}
