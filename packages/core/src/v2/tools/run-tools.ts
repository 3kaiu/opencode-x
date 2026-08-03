// V2 command execution tool (M4 §4.6): run a shell command inside the
// workspace with a hard timeout and capped output. cwd is pinned to the
// workspace root; output returns exit code + truncated stdout/stderr so
// results render into the structured tool-history feedback.
export * as RunTools from "./run-tools"

import { Effect } from "effect"
import { spawn } from "node:child_process"

export const MAX_RUN_OUTPUT_BYTES = 4096

export interface RunResult {
  readonly exitCode: number | null
  readonly output: string
  readonly timedOut: boolean
}

/** Runs a command string in the workspace root; never rejects. */
export const run = Effect.fn("V2Tool.run")(function* (root: string, command: string, timeoutMs = 15_000) {
  const result: RunResult = yield* Effect.promise(
    () =>
      new Promise<RunResult>((resolve) => {
        const child = spawn(command, { cwd: root, shell: true, stdio: ["ignore", "pipe", "pipe"] })
        let out = ""
        let timedOut = false
        const timer = setTimeout(() => {
          timedOut = true
          child.kill("SIGKILL")
        }, timeoutMs)
        const onData = (chunk: Buffer) => {
          if (out.length < MAX_RUN_OUTPUT_BYTES) out += chunk.toString().slice(0, MAX_RUN_OUTPUT_BYTES - out.length)
        }
        child.stdout.on("data", onData)
        child.stderr.on("data", onData)
        child.on("close", (code) => {
          clearTimeout(timer)
          resolve({ exitCode: code, output: out, timedOut })
        })
        child.on("error", () => {
          clearTimeout(timer)
          resolve({ exitCode: null, output: out, timedOut })
        })
      }),
  )
  const head = result.timedOut ? `error: command timed out after ${timeoutMs}ms\n` : `exit ${result.exitCode}\n`
  return `${head}${result.output.trim() || "(no output)"}`
})
