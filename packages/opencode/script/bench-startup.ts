#!/usr/bin/env bun

import { spawnSync } from "child_process"
import path from "path"

const dir = path.resolve(import.meta.dirname, "..")

const commands = [
  ["--version"],
  ["--help"],
  ["completion"],
  ["debug", "paths"],
]

console.log("=== Startup Benchmark ===")
for (const cmd of commands) {
  const times: number[] = []
  for (let i = 0; i < 5; i++) {
    const start = performance.now()
    spawnSync("bun", ["run", "--conditions=browser", "src/index.ts", ...cmd], {
      cwd: dir,
      stdio: "ignore",
    })
    const end = performance.now()
    times.push(end - start)
  }
  times.sort((a, b) => a - b)
  const median = times[Math.floor(times.length / 2)]
  console.log(`${cmd.join(" ").padEnd(20)} median: ${median.toFixed(2)}ms (${times.map((t) => t.toFixed(0)).join(", ")} ms)`)
}
