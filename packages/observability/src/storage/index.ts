import fs from "fs"
import os from "os"
import path from "path"
import { gzipSync } from "zlib"
import type { Config } from "../config"

export function defaultLogDir(): string {
  return path.join(os.homedir(), ".local", "share", "opencode", "log")
}

export interface Storage {
  readonly logDir: string
  readonly append: (category: string, line: string) => void
  readonly flush: () => void
  readonly close: () => void
  readonly cleanup: () => void
  readonly query: (predicate: (category: string, line: string) => boolean) => string[]
}

function categoryDir(root: string, category: string): string {
  return path.join(root, category)
}

function dayStamp(): string {
  return new Date().toISOString().slice(0, 10)
}

export function makeStorage(config: Config): Storage {
  const root = path.join(config.logDir, "logs")
  const buffers = new Map<string, string[]>()
  let closed = false

  function dirFor(category: string): string {
    const dir = categoryDir(root, category)
    fs.mkdirSync(dir, { recursive: true })
    return dir
  }

  function currentFile(category: string): string {
    const dir = dirFor(category)
    const base = path.join(dir, `${category}-${dayStamp()}.log`)
    return base
  }

  function rotateIfNeeded(file: string, incomingBytes: number) {
    try {
      const existing = fs.existsSync(file) ? fs.statSync(file).size : 0
      if (existing > 0 && existing + incomingBytes > config.maxFileSizeBytes) {
        const compressed = `${file}.gz`
        if (!fs.existsSync(compressed)) fs.writeFileSync(compressed, gzipSync(fs.readFileSync(file)))
        fs.rmSync(file)
      }
    } catch {
      // never let storage failure break the app
    }
  }

  function append(category: string, line: string) {
    if (closed || !config.enabled) return
    const bucket = buffers.get(category)
    if (bucket) bucket.push(line)
    else buffers.set(category, [line])
  }

  function flush() {
    if (closed) return
    for (const [category, lines] of buffers) {
      if (lines.length === 0) continue
      const file = currentFile(category)
      const incomingBytes = lines.reduce((sum, line) => sum + line.length + 1, 0)
      rotateIfNeeded(file, incomingBytes)
      try {
        fs.appendFileSync(file, lines.join("\n") + "\n")
      } catch {
        // fallback: write to stderr so logs are never silently lost
        for (const line of lines) process.stderr.write(line + "\n")
      }
      buffers.set(category, [])
    }
  }

  function cleanup() {
    const dirs = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory())
    for (const entry of dirs) {
      const dir = path.join(root, entry.name)
      const files = fs.readdirSync(dir).filter((f) => f.endsWith(".log") || f.endsWith(".log.gz"))
      const total = files.reduce((sum, f) => {
        const full = path.join(dir, f)
        try {
          return sum + fs.statSync(full).size
        } catch {
          return sum
        }
      }, 0)
      for (const f of files) {
        const full = path.join(dir, f)
        const match = /-(\d{4}-\d{2}-\d{2})\.log(\.gz)?$/.exec(f)
        if (match) {
          const ageDays = (Date.now() - new Date(match[1]).getTime()) / 86400000
          if (ageDays > config.retentionDays) {
            fs.rmSync(full, { force: true })
            continue
          }
        }
        if (total > config.maxTotalBytes) {
          fs.rmSync(full, { force: true })
        }
      }
    }
  }

  function query(predicate: (category: string, line: string) => boolean): string[] {
    const matches: string[] = []
    if (!fs.existsSync(root)) return matches
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const dir = path.join(root, entry.name)
      for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".log"))) {
        const content = fs.readFileSync(path.join(dir, file), "utf8")
        for (const line of content.split("\n")) {
          if (line && predicate(entry.name, line)) matches.push(line)
        }
      }
    }
    return matches
  }

  return { logDir: root, append, flush, cleanup, query, close: flush }
}
