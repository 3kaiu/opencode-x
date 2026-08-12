import { afterEach, describe, expect, test } from "bun:test"
import fs from "fs"
import os from "os"
import path from "path"
import { makeObservability } from "../src/service"
import { defaultRunContext } from "../src/context"
import type { LogEntry } from "@opencode-ai/schema"

const entry = (level: LogEntry["level"]): Omit<LogEntry, "service"> => ({
  timestamp: 1,
  level,
  package: "llm",
  module: "provider",
  function: "call",
  traceId: "t1",
  spanId: "s1",
  sessionId: "ses_1",
  status: "success",
})

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "obs-service-"))
}

afterEach(() => {
  delete process.env.OPENCODE_LOG_LEVEL
  delete process.env.OPENCODE_OBSERVABILITY_DISABLED
  delete process.env.OPENCODE_TRACE_FILE
})

describe("service", () => {
  test("env config drives production filtering when context is default", () => {
    process.env.OPENCODE_LOG_LEVEL = "debug"
    const dir = tempDir()
    const obs = makeObservability(dir, defaultRunContext)
    expect(obs.config.level).toBe("debug")
    obs.log(entry("INFO"))
    obs.exporter.flush()
    const lines = obs.storage.query((cat, line) => line.includes("level=INFO") && cat === "runtime")
    expect(lines.length).toBe(1)
  })

  test("explicit run context wins over env config", () => {
    process.env.OPENCODE_LOG_LEVEL = "debug"
    const dir = tempDir()
    const obs = makeObservability(dir, { ...defaultRunContext, level: "production" })
    obs.log(entry("INFO"))
    obs.exporter.flush()
    const lines = obs.storage.query((cat, line) => line.includes("level=INFO") && cat === "runtime")
    expect(lines.length).toBe(0)
  })

  test("span recording follows sampling decision", () => {
    const dir = tempDir()
    const off = makeObservability(dir, { ...defaultRunContext, sampling: 0 })
    off.span({ name: "llm.stream", traceId: "t0" })
    off.exporter.flush()
    expect(off.storage.query((cat) => cat === "performance").length).toBe(0)

    const on = makeObservability(dir, { ...defaultRunContext, sampling: 1 })
    on.span({ name: "llm.stream", traceId: "t1" })
    on.exporter.flush()
    const lines = on.storage.query((cat, line) => cat === "performance" && line.includes("llm.stream"))
    expect(lines.length).toBe(1)
  })

  test("disabled observability drops everything", () => {
    process.env.OPENCODE_OBSERVABILITY_DISABLED = "1"
    const dir = tempDir()
    const obs = makeObservability(dir, { ...defaultRunContext, level: "debug", sampling: 1 })
    obs.log(entry("ERROR"))
    obs.record("counter", "tool.call", {}, 1)
    obs.span({ name: "x", traceId: "t" })
    obs.exporter.flush()
    expect(obs.storage.query(() => true).length).toBe(0)
    expect(obs.snapshot().counters["tool.call"]).toBeUndefined()
  })
})
