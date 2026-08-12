import path from "path"
import { Effect } from "effect"
import { AbsolutePath } from "../../schema"
import type { FSUtil } from "../../fs-util"
import type { AppProcess } from "../../process"
import { OperationError, Repository } from "../schema"
import { makeOperations } from "../operations"
import { run, resolvePath } from "../process"

export type RepositoryOps = ReturnType<typeof makeRepositoryOps>

export const makeRepositoryOps = (deps: {
  readonly fs: FSUtil.Interface
  readonly proc: AppProcess.Interface
  readonly operations: ReturnType<typeof makeOperations>
}) => {
  const { operation, repositoryOperation } = deps.operations

  const discover = Effect.fn("Git.repo.discover")(function* (input: AbsolutePath) {
    const dotgit = yield* deps.fs.up({ targets: [".git"], start: input }).pipe(
      Effect.map((matches) => matches[0]),
      Effect.catch(() => Effect.succeed(undefined)),
    )
    if (!dotgit) return undefined

    const cwd = path.dirname(dotgit)
    const git = run(cwd, deps.proc)
    const topLevel = yield* git(["rev-parse", "--show-toplevel"])
    const gitDir = yield* git(["rev-parse", "--git-dir"])
    const commonDir = yield* git(["rev-parse", "--git-common-dir"])
    if (gitDir.exitCode !== 0 || commonDir.exitCode !== 0) return undefined

    return new Repository({
      worktree: AbsolutePath.make(topLevel.exitCode === 0 ? resolvePath(cwd, topLevel.text) : cwd),
      gitDirectory: AbsolutePath.make(resolvePath(cwd, gitDir.text)),
      commonDirectory: AbsolutePath.make(resolvePath(cwd, commonDir.text)),
    })
  })

  const remote = Effect.fn("Git.remote.get")(function* (repository: Repository, name = "origin") {
    const result = yield* run(repository.worktree, deps.proc)(["remote", "get-url", name])
    if (result.exitCode !== 0) return undefined
    return result.text.trim() || undefined
  })

  const roots = Effect.fn("Git.history.rootCommits")(function* (repository: Repository) {
    const result = yield* run(repository.worktree, deps.proc)(["rev-list", "--max-parents=0", "HEAD"])
    if (result.exitCode !== 0) return []
    return result.text
      .split("\n")
      .map((item) => item.trim())
      .filter(Boolean)
      .toSorted()
  })

  const head = Effect.fn("Git.history.head")(function* (repository: Repository) {
    const result = yield* run(repository.worktree, deps.proc)(["rev-parse", "HEAD"])
    if (result.exitCode !== 0) return undefined
    return result.text.trim() || undefined
  })

  const branch = Effect.fn("Git.history.branch")(function* (repository: Repository) {
    const result = yield* run(repository.worktree, deps.proc)(["symbolic-ref", "--quiet", "--short", "HEAD"])
    if (result.exitCode !== 0) return undefined
    return result.text.trim() || undefined
  })

  const remoteHead = Effect.fn("Git.history.defaultRemoteBranch")(function* (
    repository: Repository,
    remoteName = "origin",
  ) {
    const result = yield* run(repository.worktree, deps.proc)(["symbolic-ref", `refs/remotes/${remoteName}/HEAD`])
    if (result.exitCode !== 0) return undefined
    return result.text.trim().replace(new RegExp(`^refs/remotes/${remoteName}/`), "") || undefined
  })

  const clone = Effect.fn("Git.repo.clone")(function* (input: {
    remote: string
    directory: AbsolutePath
    branch?: string
    depth?: number
  }) {
    yield* operation("clone", AbsolutePath.make(path.dirname(input.directory)), [
      "clone",
      "--depth",
      String(input.depth ?? 100),
      ...(input.branch ? ["--branch", input.branch] : []),
      "--",
      input.remote,
      input.directory,
    ])
    const repository = yield* discover(input.directory)
    if (repository) return repository
    return yield* new OperationError({
      operation: "clone",
      directory: input.directory,
      message: "Cloned repository could not be opened",
    })
  })

  const fetch = Effect.fn("Git.sync.fetchRemotes")(function* (
    repository: Repository,
    input: { prune?: boolean } = {},
  ) {
    yield* operation("fetch", repository.worktree, ["fetch", "--all", ...(input.prune === false ? [] : ["--prune"])])
  })

  const fetchBranch = Effect.fn("Git.sync.fetchBranch")(function* (
    repository: Repository,
    input: { remote?: string; branch: string; force?: boolean },
  ) {
    const remoteName = input.remote ?? "origin"
    const spec = `refs/heads/${input.branch}:refs/remotes/${remoteName}/${input.branch}`
    yield* operation("fetch", repository.worktree, ["fetch", remoteName, input.force === false ? spec : `+${spec}`])
  })

  const checkout = Effect.fn("Git.sync.checkoutRemoteBranch")(function* (
    repository: Repository,
    input: { remote?: string; branch: string; reset?: boolean },
  ) {
    const remoteName = input.remote ?? "origin"
    yield* operation("checkout", repository.worktree, [
      "checkout",
      ...(input.reset === false ? [input.branch] : ["-B", input.branch, `${remoteName}/${input.branch}`]),
    ])
  })

  const reset = Effect.fn("Git.sync.resetHard")(function* (repository: Repository, revision: string) {
    yield* operation("reset", repository.worktree, ["reset", "--hard", revision])
  })

  const create = Effect.fn("Git.repo.create")(function* (input: {
    worktree: AbsolutePath
    gitDirectory: AbsolutePath
    seed?: Repository
  }) {
    yield* deps.fs.ensureDir(input.gitDirectory).pipe(
      Effect.mapError(
        (cause) =>
          new OperationError({
            operation: "create",
            directory: input.gitDirectory,
            message: "Failed to create Git storage",
            cause,
          }),
      ),
    )
    const repository = new Repository({
      worktree: input.worktree,
      gitDirectory: input.gitDirectory,
      commonDirectory: input.gitDirectory,
    })
    yield* repositoryOperation("create", repository, ["init"])
    yield* Effect.forEach(
      [
        ["core.autocrlf", "false"],
        ["core.longpaths", "true"],
        ["core.symlinks", "true"],
        ["core.fsmonitor", "false"],
        ["feature.manyFiles", "true"],
        ["index.version", "4"],
        ["index.threads", "true"],
        ["core.untrackedCache", "true"],
      ],
      ([key, value]) => repositoryOperation("create", repository, ["config", key, value]),
      { discard: true },
    )
    if (!input.seed) return repository
    yield* deps.fs.ensureDir(path.join(input.gitDirectory, "objects", "info")).pipe(
      Effect.mapError(
        (cause) =>
          new OperationError({
            operation: "create",
            directory: input.gitDirectory,
            message: "Failed to configure shared Git objects",
            cause,
          }),
      ),
    )
    yield* deps.fs
      .writeFileString(
        path.join(input.gitDirectory, "objects", "info", "alternates"),
        path.join(input.seed.commonDirectory, "objects") + "\n",
      )
      .pipe(
        Effect.mapError(
          (cause) =>
            new OperationError({
              operation: "create",
              directory: input.gitDirectory,
              message: "Failed to configure shared Git objects",
              cause,
            }),
        ),
      )
    yield* deps.fs
      .copyFile(path.join(input.seed.gitDirectory, "index"), path.join(input.gitDirectory, "index"))
      .pipe(Effect.catch(() => Effect.void))
    return repository
  })

  return {
    discover,
    remote,
    roots,
    head,
    branch,
    remoteHead,
    clone,
    create,
    fetch,
    fetchBranch,
    checkout,
    reset,
  }
}
