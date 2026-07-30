export * as SubagentSpawner from "./spawner"

import { Effect, Schema } from "effect"
import { SubagentDepth } from "./depth"
import { SubagentRegistry } from "./registry"
import type { SubAgentType } from "./registry"

export interface SubAgentConfig {
  readonly type: SubAgentType
  readonly task: string
  readonly model?: string
  readonly allowedTools?: ReadonlyArray<string>
  readonly maxDepth?: number
}

export interface SubAgentResult {
  readonly output: string
  readonly success: boolean
  readonly error?: string
  readonly tokensUsed?: number
}

export class SubAgentSpawnError extends Schema.TaggedErrorClass<SubAgentSpawnError>()("SubAgentSpawnError", {
  message: Schema.String,
  exitCode: Schema.optional(Schema.Number),
  stderr: Schema.optional(Schema.String),
}) {}

const resolveWorkerPath = (): string => {
  const base = import.meta.dir
  return `${base}/worker.ts`
}

const buildArgs = (config: SubAgentConfig): ReadonlyArray<string> => {
  const payload = {
    type: config.type,
    task: config.task,
    model: config.model,
    allowedTools: config.allowedTools,
  }
  return ["--subagent-worker", JSON.stringify(payload)]
}

const parseResult = (stdout: string): SubAgentResult => {
  const trimmed = stdout.trim()
  if (!trimmed) {
    return { output: "", success: false, error: "Sub-agent produced no output" }
  }
  const lastNewline = trimmed.lastIndexOf("\n")
  const jsonLine = lastNewline >= 0 ? trimmed.slice(lastNewline + 1) : trimmed
  try {
    const parsed = JSON.parse(jsonLine) as Record<string, unknown>
    return {
      output: typeof parsed.output === "string" ? parsed.output : "",
      success: parsed.success === true,
      error: typeof parsed.error === "string" ? parsed.error : undefined,
      tokensUsed: typeof parsed.tokensUsed === "number" ? parsed.tokensUsed : undefined,
    }
  } catch {
    return { output: trimmed, success: false, error: "Failed to parse sub-agent output" }
  }
}

export const spawnSubAgent = (config: SubAgentConfig): Effect.Effect<SubAgentResult> =>
  Effect.gen(function* () {
    if (!SubagentDepth.canSpawn()) {
      return {
        output: "",
        success: false,
        error: `Max nesting depth (${SubagentDepth.MAX_NESTING_DEPTH}) reached`,
      }
    }

    const definition = SubagentRegistry.resolve(config.type)
    if (!definition) {
      return {
        output: "",
        success: false,
        error: `Unknown sub-agent type: ${config.type}`,
      }
    }

    const childEnv = SubagentDepth.getChildEnv()
    const workerPath = resolveWorkerPath()
    const args = buildArgs(config)

    const result = yield* Effect.tryPromise({
      try: () => {
        const proc = Bun.spawn({
          cmd: ["bun", "run", workerPath, ...args],
          env: childEnv,
          stdout: "pipe",
          stderr: "pipe",
          stdin: undefined,
        })
        return proc.exited.then(async (exitCode) => {
          const stdoutChunks: Uint8Array[] = []
          const stderrChunks: Uint8Array[] = []
          const reader = proc.stdout.getReader()
          const errReader = proc.stderr.getReader()
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            stdoutChunks.push(value)
          }
          while (true) {
            const { done, value } = await errReader.read()
            if (done) break
            stderrChunks.push(value)
          }
          const stdoutText = new TextDecoder().decode(
            stdoutChunks.length > 0 ? concatBytes(stdoutChunks) : new Uint8Array(0),
          )
          const stderrText = new TextDecoder().decode(
            stderrChunks.length > 0 ? concatBytes(stderrChunks) : new Uint8Array(0),
          )
          return { exitCode, stdout: stdoutText, stderr: stderrText }
        })
      },
      catch: (cause) =>
        new SubAgentSpawnError({
          message: cause instanceof Error ? cause.message : String(cause),
        }),
    })

    if (result.exitCode !== 0) {
      return {
        output: "",
        success: false,
        error: `Sub-agent exited with code ${result.exitCode}: ${result.stderr.slice(0, 500)}`,
      }
    }

    return parseResult(result.stdout)
  }).pipe(
    Effect.catchTag("SubAgentSpawnError", (error) =>
      Effect.succeed({
        output: "",
        success: false,
        error: `Failed to spawn sub-agent: ${error.message}`,
      }),
    ),
  )

const concatBytes = (chunks: Uint8Array[]): Uint8Array => {
  const total = chunks.reduce((sum, c) => sum + c.length, 0)
  const result = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.length
  }
  return result
}
