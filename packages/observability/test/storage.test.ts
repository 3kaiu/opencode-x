import { describe, expect, test } from "bun:test"
import fs from "fs"
import os from "os"
import path from "path"
import { defaultConfig, loadConfig } from "../src/config"
import { makeStorage } from "../src/storage"
import { makeObservability } from "../src/service"
import { defaultRunContext } from "../src/context"

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "obs-"))

describe("storage", () => {
  test("appends lines to per-category files and flushes", () => {
    const dir = tmpDir()
    const config = { ...defaultConfig(dir), enabled: true }
    const storage = makeStorage(config)
    storage.append("runtime", "a=1")
    storage.append("runtime", "a=2")
    storage.flush()
    const file = path.join(dir, "logs", "runtime", `runtime-${new Date().toISOString().slice(0, 10)}.log`)
    expect(fs.existsSync(file)).toBe(true)
    expect(fs.readFileSync(file, "utf8")).toContain("a=1")
    expect(fs.readFileSync(file, "utf8")).toContain("a=2")
  })

  test("query returns lines matching predicate", () => {
    const dir = tmpDir()
    const config = { ...defaultConfig(dir), enabled: true }
    const storage = makeStorage(config)
    storage.append("runtime", "traceId=t1 level=ERROR")
    storage.append("runtime", "traceId=t2 level=INFO")
    storage.flush()
    const hits = storage.query((category, line) => line.includes("traceId=t1"))
    expect(hits).toHaveLength(1)
    expect(hits[0]).toContain("traceId=t1")
  })

  test("cleanup removes files past retention days", () => {
    const dir = tmpDir()
    const config = { ...defaultConfig(dir), enabled: true, retentionDays: 0 }
    const storage = makeStorage(config)
    const targetDir = path.join(dir, "logs", "runtime")
    fs.mkdirSync(targetDir, { recursive: true })
    const old = path.join(targetDir, "runtime-2000-01-01.log")
    fs.writeFileSync(old, "stale")
    storage.cleanup()
    expect(fs.existsSync(old)).toBe(false)
  })

  test("oversized log rotates into a gzip archive", () => {
    const dir = tmpDir()
    const config = { ...defaultConfig(dir), enabled: true, maxFileSizeBytes: 16 }
    const storage = makeStorage(config)
    storage.append("runtime", "x".repeat(40))
    storage.flush()
    storage.append("runtime", "y")
    storage.flush()
    const day = new Date().toISOString().slice(0, 10)
    const targetDir = path.join(dir, "logs", "runtime")
    const files = fs.readdirSync(targetDir)
    expect(files.some((f) => f === `runtime-${day}.log.gz`)).toBe(true)
  })
})

describe("service", () => {
  test("log writes only allowed levels in production", () => {
    const dir = tmpDir()
    const obs = makeObservability(dir, { ...defaultRunContext, level: "production" })
    obs.log({ timestamp: 1, level: "ERROR", package: "llm", module: "m", function: "f", traceId: "t", spanId: "s", sessionId: "x", status: "failure" })
    obs.log({ timestamp: 1, level: "INFO", package: "llm", module: "m", function: "f", traceId: "t", spanId: "s", sessionId: "x", status: "success" })
    obs.storage.flush()
    const runtime = path.join(dir, "logs", "runtime", `runtime-${new Date().toISOString().slice(0, 10)}.log`)
    const content = fs.readFileSync(runtime, "utf8")
    expect(content).toContain("level=ERROR")
    expect(content).not.toContain("level=INFO")
  })

  test("disabled observability drops all logs", () => {
    const dir = tmpDir()
    const config = loadConfig({ OPENCODE_OBSERVABILITY_DISABLED: "1" }, dir)
    const obs = makeObservability(dir, defaultRunContext)
    obs.log({ timestamp: 1, level: "FATAL", package: "llm", module: "m", function: "f", traceId: "t", spanId: "s", sessionId: "x", status: "failure" })
    obs.storage.flush()
    const runtime = path.join(dir, "logs", "runtime", "runtime.log")
    expect(fs.existsSync(runtime)).toBe(false)
  })
})
