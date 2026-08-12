import path from "path"
import { Effect } from "effect"
import { ChildProcess } from "effect/unstable/process"
import { FSUtil } from "../fs-util"
import type { AppProcess } from "../process"

export interface ProcessResult {
  readonly exitCode: number
  readonly text: string
  readonly stderr: string
}

export function run(cwd: string, proc: AppProcess.Interface) {
  return (args: string[]) =>
    execute(cwd, proc)(args).pipe(Effect.catch(() => Effect.succeed({ exitCode: 1, text: "", stderr: "" })))
}

export function execute(cwd: string, proc: AppProcess.Interface) {
  return (args: string[]): Effect.Effect<ProcessResult, AppProcess.AppProcessError> =>
    proc
      .run(
        ChildProcess.make("git", args, {
          cwd,
          extendEnv: true,
          stdin: "ignore",
        }),
      )
      .pipe(
        Effect.map(
          (result) =>
            ({
              exitCode: result.exitCode,
              text: result.stdout.toString("utf8"),
              stderr: result.stderr.toString("utf8"),
            }) satisfies ProcessResult,
        ),
      )
}

export function resolvePath(cwd: string, value: string): string {
  const trimmed = value.replace(/[\r\n]+$/, "")
  if (!trimmed) return cwd
  const normalized = FSUtil.windowsPath(trimmed)
  if (path.isAbsolute(normalized)) return path.normalize(normalized)
  return path.resolve(cwd, normalized)
}
