import { Effect } from "effect"
import { ChildProcess } from "effect/unstable/process"
import { AbsolutePath } from "../schema"
import type { AppProcess } from "../process"
import { OperationError, Repository } from "./schema"
import { execute } from "./process"

export const makeOperations = (proc: AppProcess.Interface) => {
  const operation = Effect.fnUntraced(function* (
    operation: OperationError["operation"],
    directory: AbsolutePath,
    args: string[],
  ) {
    const result = yield* execute(directory, proc)(args).pipe(
      Effect.mapError((cause) => new OperationError({ operation, directory, message: cause.message, cause })),
    )
    if (result.exitCode === 0) return
    return yield* new OperationError({
      operation,
      directory,
      message: result.stderr.trim() || result.text.trim() || `Git ${operation} failed`,
    })
  })

  const repositoryArgs = (repository: Repository, args: string[]) => [
    "--git-dir",
    repository.gitDirectory,
    "--work-tree",
    repository.worktree,
    ...args,
  ]

  const repositoryOperation = Effect.fnUntraced(function* (
    operationName: OperationError["operation"],
    repository: Repository,
    args: string[],
    options?: { stdin?: string; env?: Record<string, string> },
  ) {
    const result = yield* proc
      .run(
        ChildProcess.make("git", repositoryArgs(repository, args), {
          cwd: repository.worktree,
          env: options?.env,
          extendEnv: true,
        }),
        { stdin: options?.stdin },
      )
      .pipe(
        Effect.mapError(
          (cause) =>
            new OperationError({
              operation: operationName,
              directory: repository.worktree,
              message: cause.message,
              cause,
            }),
        ),
      )
    const text = result.stdout.toString("utf8")
    if (result.exitCode === 0) return { text, stderr: result.stderr.toString("utf8") }
    return yield* new OperationError({
      operation: operationName,
      directory: repository.worktree,
      message: result.stderr.toString("utf8").trim() || text.trim() || `Git ${operationName} failed`,
    })
  })

  return { operation, repositoryOperation }
}
