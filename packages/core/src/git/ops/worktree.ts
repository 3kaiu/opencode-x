import { Effect } from "effect"
import { ChildProcess } from "effect/unstable/process"
import { AbsolutePath } from "../../schema"
import type { AppProcess } from "../../process"
import { Repository, Worktree, WorktreeError } from "../schema"
import { resolvePath } from "../process"
import type { RepositoryOps } from "./repository"

export type WorktreeOps = ReturnType<typeof makeWorktreeOps>

export const makeWorktreeOps = (deps: {
  readonly proc: AppProcess.Interface
  readonly repo: RepositoryOps
}) => {
  const worktreeRun = Effect.fnUntraced(function* (
    operation: "create" | "remove" | "list",
    repository: Repository,
    args: string[],
    worktreeDirectory?: AbsolutePath,
    cwd = repository.worktree,
  ) {
    const result = yield* deps.proc
      .run(ChildProcess.make("git", args, { cwd, extendEnv: true, stdin: "ignore" }))
      .pipe(
        Effect.mapError(
          (cause) => new WorktreeError({ operation, directory: worktreeDirectory, message: cause.message, cause }),
        ),
      )
    if (result.exitCode === 0) return result.stdout.toString("utf8")
    const message = result.stderr.toString("utf8").trim() || result.stdout.toString("utf8").trim() || "Git failed"
    return yield* new WorktreeError({
      operation,
      directory: worktreeDirectory,
      message,
      forceRequired: operation === "remove" && /contains modified or untracked files|is dirty/i.test(message),
    })
  })

  const worktreeCreate = Effect.fn("Git.worktree.create")(function* (input: {
    repository: Repository
    directory: AbsolutePath
  }) {
    yield* worktreeRun(
      "create",
      input.repository,
      ["worktree", "add", "--detach", input.directory, "HEAD"],
      input.directory,
    )
    const repository = yield* deps.repo.discover(input.directory)
    if (repository) return repository
    return yield* new WorktreeError({
      operation: "create",
      directory: input.directory,
      message: "Created worktree could not be opened",
    })
  })

  const worktreeRemove = Effect.fn("Git.worktree.remove")(function* (input: {
    repository: Repository
    directory: AbsolutePath
    force: boolean
  }) {
    yield* worktreeRun(
      "remove",
      input.repository,
      ["worktree", "remove", ...(input.force ? ["--force"] : []), input.directory],
      input.directory,
      input.repository.commonDirectory,
    )
  })

  const worktreeList = Effect.fn("Git.worktree.list")(function* (repository: Repository) {
    return (yield* worktreeRun("list", repository, ["worktree", "list", "--porcelain"]))
      .split("\n")
      .filter((line) => line.startsWith("worktree "))
      .map(
        (line, index) =>
          new Worktree({
            directory: AbsolutePath.make(resolvePath(repository.worktree, line.slice("worktree ".length).trim())),
            kind: index === 0 ? "main" : "linked",
          }),
      )
  })

  return { worktreeRun, create: worktreeCreate, remove: worktreeRemove, list: worktreeList }
}