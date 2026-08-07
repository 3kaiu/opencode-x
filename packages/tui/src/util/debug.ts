import { writeFileSync, appendFileSync } from "node:fs"

const TUI_LOG = "/tmp/opencode-tui-debug.log"
const bootTime = Date.now()
// Enable with OPENCODE_DEBUG_LOG=1; off by default so production runs have zero
// logging overhead (appendFileSync on every event would skew perf measurements).
const enabled = process.env.OPENCODE_DEBUG_LOG === "1"
let initialized = false

export function debugLog(...args: unknown[]) {
  if (!enabled) return
  if (!initialized) {
    initialized = true
    try {
      writeFileSync(TUI_LOG, "")
    } catch {
      // ignore
    }
  }
  const line =
    `+${Date.now() - bootTime}ms ` +
    args.map((a) => (typeof a === "string" ? a : safeJSON(a))).join(" ") +
    "\n"
  try {
    appendFileSync(TUI_LOG, line)
  } catch {
    // never let logging break the UI
  }
}

// Timestamped boot marker: [mark] +<ms since TUI process start> <label>
export function mark(label: string, detail?: unknown) {
  debugLog("[mark]", `+${Date.now() - bootTime}ms`, label, detail === undefined ? "" : safeJSON(detail))
}

// Time a promise and log its duration under label.
export function timed<T>(label: string, promise: Promise<T>): Promise<T> {
  if (!enabled) return promise
  const start = Date.now()
  return promise.finally(() => debugLog("[timed]", label, `${Date.now() - start}ms`))
}

let memTimer: Timer | undefined

// Sample process memory every 2s: rss/heapUsed/heapTotal/external.
export function startMemSampling() {
  if (!enabled || memTimer) return
  memTimer = setInterval(() => {
    const m = process.memoryUsage()
    debugLog(
      "[mem]",
      `rss=${Math.round(m.rss / 1024 / 1024)}MB`,
      `heap=${Math.round(m.heapUsed / 1024 / 1024)}MB`,
      `heapTotal=${Math.round(m.heapTotal / 1024 / 1024)}MB`,
      `external=${Math.round(m.external / 1024 / 1024)}MB`,
    )
  }, 2000)
}

function safeJSON(value: unknown) {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}
