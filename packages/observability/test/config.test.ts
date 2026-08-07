import { describe, expect, test } from "bun:test"
import { defaultConfig, loadConfig, samplingForMode } from "../src/config"
import { allowed, entryToString } from "../src/logger"
import { shouldSample, defaultRunContext } from "../src/context"
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

describe("config", () => {
  test("production defaults to 10% sampling and ERROR rank filter", () => {
    expect(samplingForMode("production")).toBe(0.1)
    expect(samplingForMode("debug")).toBe(1)
    const config = loadConfig({}, "/tmp")
    expect(config.level).toBe("production")
    expect(config.sampling).toBe(0.1)
    expect(config.enabled).toBe(true)
  })

  test("OPENCODE_LOG_LEVEL=debug enables full logging", () => {
    const config = loadConfig({ OPENCODE_LOG_LEVEL: "debug" }, "/tmp")
    expect(config.level).toBe("debug")
    expect(config.sampling).toBe(1)
  })

  test("observability can be disabled", () => {
    const config = loadConfig({ OPENCODE_OBSERVABILITY_DISABLED: "1" }, "/tmp")
    expect(config.enabled).toBe(false)
  })
})

describe("logger level filter", () => {
  test("production allows ERROR/FATAL but drops DEBUG/INFO", () => {
    const ctx = { ...defaultRunContext, level: "production" as const }
    expect(allowed({ ...entry("ERROR") }, ctx)).toBe(true)
    expect(allowed({ ...entry("FATAL") }, ctx)).toBe(true)
    expect(allowed({ ...entry("INFO") }, ctx)).toBe(false)
    expect(allowed({ ...entry("DEBUG") }, ctx)).toBe(false)
  })

  test("debug mode allows TRACE/DEBUG/INFO", () => {
    const ctx = { ...defaultRunContext, level: "debug" as const }
    expect(allowed({ ...entry("TRACE") }, ctx)).toBe(true)
    expect(allowed({ ...entry("DEBUG") }, ctx)).toBe(true)
    expect(allowed({ ...entry("INFO") }, ctx)).toBe(true)
  })

  test("serialized entry includes null for missing optional fields", () => {
    const line = entryToString({ ...entry("INFO"), agentId: undefined })
    expect(line).toContain("agentId=null")
  })
})

describe("sampling", () => {
  test("sampling 100% admits everything", () => {
    const ctx = { ...defaultRunContext, sampling: 1 }
    expect(shouldSample(ctx, "any")).toBe(true)
  })

  test("sampling 0 rejects everything", () => {
    const ctx = { ...defaultRunContext, sampling: 0 }
    expect(shouldSample(ctx, "any")).toBe(false)
  })

  test("sampling 10% admits a deterministic subset", () => {
    const ctx = { ...defaultRunContext, sampling: 0.1 }
    const ids = Array.from({ length: 500 }, (_, i) => `t${i}`)
    const admitted = ids.filter((id) => shouldSample(ctx, id)).length
    expect(admitted).toBeGreaterThan(0)
    expect(admitted).toBeLessThan(500)
    expect(shouldSample(ctx, "t42")).toBe(shouldSample(ctx, "t42"))
  })
})
