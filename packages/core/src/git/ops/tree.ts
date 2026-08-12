import path from "path"
import { randomUUID } from "crypto"
import { Effect } from "effect"
import { ChildProcess } from "effect/unstable/process"
import { AbsolutePath, RelativePath } from "../../schema"
import type { FSUtil } from "../../fs-util"
import type { AppProcess } from "../../process"
import { File } from "../../file"
import { OperationError, Repository, TreeID } from "../schema"
import type { makeOperations } from "../operations"

export type TreeOps = ReturnType<typeof makeTreeOps>

export const makeTreeOps = (deps: {
  readonly fs: FSUtil.Interface
  readonly proc: AppProcess.Interface
  readonly operations: ReturnType<typeof makeOperations>
  readonly locked: <A, E, R>(repository: Repository, effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>
}) => {
  const { repositoryOperation } = deps.operations

  const refresh = Effect.fn("Git.index.refresh")(function* (input: {
    repository: Repository
    scope: RelativePath
    ignores?: Repository
    maximumUntrackedFileBytes?: number
  }) {
    const list = (args: string[]) =>
      repositoryOperation("refresh", input.repository, args).pipe(
        Effect.map((result) => result.text.split("\0").filter(Boolean)),
      )
    const [tracked, untracked] = yield* Effect.all(
      [
        list(["diff-files", "--name-only", "-z", "--", input.scope]),
        list(["ls-files", "--others", "--exclude-standard", "-z", "--", input.scope]),
      ],
      { concurrency: 2 },
    )
    const candidates = Array.from(new Set([...tracked, ...untracked]))
    if (!candidates.length) return { skipped: [] }
    const ignored = input.ignores
      ? new Set(
          (yield* repositoryOperation("refresh", input.ignores, ["check-ignore", "--no-index", "--stdin", "-z"], {
            stdin: candidates.join("\0") + "\0",
          }).pipe(Effect.catch(() => Effect.succeed({ text: "", stderr: "" })))).text
            .split("\0")
            .filter(Boolean),
        )
      : new Set<string>()
    const allowed = candidates.filter((item) => !ignored.has(item))
    const maximum = input.maximumUntrackedFileBytes
    const skipped = maximum
      ? (yield* Effect.forEach(
          untracked.filter((item) => allowed.includes(item)),
          (item) =>
            deps.fs.stat(path.join(input.repository.worktree, item)).pipe(
              Effect.map((info) =>
                info.type === "File" && Number(info.size) > maximum ? RelativePath.make(item) : undefined,
              ),
              Effect.catch(() => Effect.succeed(undefined)),
            ),
          { concurrency: 8 },
        )).filter((item): item is RelativePath => item !== undefined)
      : []
    const stage = allowed.filter((item) => !skipped.includes(RelativePath.make(item)))
    const remove = [...ignored, ...skipped]
    if (remove.length)
      yield* repositoryOperation(
        "refresh",
        input.repository,
        ["rm", "--cached", "-f", "--ignore-unmatch", "--pathspec-from-file=-", "--pathspec-file-nul"],
        { stdin: remove.join("\0") + "\0" },
      )
    if (stage.length)
      yield* repositoryOperation(
        "refresh",
        input.repository,
        ["add", "--all", "--sparse", "--pathspec-from-file=-", "--pathspec-file-nul"],
        { stdin: stage.join("\0") + "\0" },
      )
    return { skipped }
  })

  const ignored = Effect.fn("Git.index.ignored")(function* (input: {
    repository: Repository
    paths: readonly RelativePath[]
  }) {
    if (!input.paths.length) return new Set<RelativePath>()
    const result = yield* deps.proc
      .run(
        ChildProcess.make(
          "git",
          [
            "--git-dir",
            input.repository.gitDirectory,
            "--work-tree",
            input.repository.worktree,
            "check-ignore",
            "--no-index",
            "--stdin",
            "-z",
          ],
          {
            cwd: input.repository.worktree,
            extendEnv: true,
          },
        ),
        { stdin: input.paths.join("\0") + "\0" },
      )
      .pipe(
        Effect.mapError(
          (cause) =>
            new OperationError({
              operation: "list_files",
              directory: input.repository.worktree,
              message: cause.message,
              cause,
            }),
        ),
      )
    if (result.exitCode !== 0 && result.exitCode !== 1)
      return yield* new OperationError({
        operation: "list_files",
        directory: input.repository.worktree,
        message: result.stderr.toString("utf8").trim() || "Failed to check ignored paths",
      })
    return new Set(
      result.stdout
        .toString("utf8")
        .split("\0")
        .filter(Boolean)
        .map((file) => RelativePath.make(file)),
    )
  })

  const writeTree = Effect.fn("Git.tree.write")(function* (repository: Repository) {
    return TreeID.make((yield* repositoryOperation("write_tree", repository, ["write-tree"])).text.trim())
  })

  const captureTree = Effect.fn("Git.tree.capture")(
    (input: {
      repository: Repository
      scopes: readonly RelativePath[]
      ignores?: Repository
      maximumUntrackedFileBytes?: number
    }) =>
      deps.locked(
        input.repository,
        Effect.gen(function* () {
          yield* Effect.forEach(input.scopes, (scope) => refresh({ ...input, scope }), { discard: true })
          return yield* writeTree(input.repository)
        }),
      ),
  )

  const treeFiles = Effect.fn("Git.tree.files")(function* (input: {
    repository: Repository
    from: TreeID
    to: TreeID
  }) {
    return (yield* repositoryOperation("list_files", input.repository, [
      "diff",
      "--name-only",
      "-z",
      input.from,
      input.to,
    ])).text
      .split("\0")
      .filter(Boolean)
      .map((file) => RelativePath.make(file))
  })

  const treeDiff = Effect.fn("Git.tree.diff")(function* (input: {
    repository: Repository
    from: TreeID
    to: TreeID
    context?: number
    paths?: readonly RelativePath[]
  }) {
    const paths = input.paths ?? (yield* treeFiles(input))
    return yield* Effect.forEach(paths, (file) =>
      Effect.gen(function* () {
        const statusText = (yield* repositoryOperation("diff", input.repository, [
          "diff",
          "--name-status",
          "--no-renames",
          input.from,
          input.to,
          "--",
          file,
        ])).text.trim()
        const status = statusText.startsWith("A") ? "added" : statusText.startsWith("D") ? "deleted" : "modified"
        const stats = (yield* repositoryOperation("diff", input.repository, [
          "diff",
          "--numstat",
          "--no-renames",
          input.from,
          input.to,
          "--",
          file,
        ])).text.split("\t")
        const binary = stats[0] === "-" || stats[1] === "-"
        const patch = binary
          ? ""
          : (yield* repositoryOperation("diff", input.repository, [
              "diff",
              `--unified=${input.context ?? 3}`,
              "--no-renames",
              input.from,
              input.to,
              "--",
              file,
            ])).text
        return {
          path: file,
          status,
          additions: binary ? 0 : Number(stats[0] ?? 0),
          deletions: binary ? 0 : Number(stats[1] ?? 0),
          patch,
        } satisfies File.Diff
      }),
    )
  })

  const entry = Effect.fnUntraced(function* (repository: Repository, tree: TreeID, file: RelativePath) {
    const text = (yield* repositoryOperation("restore", repository, [
      "ls-tree",
      "-z",
      tree,
      "--",
      file,
    ])).text.replace(/\0$/, "")
    if (!text) return
    const match = text.match(/^(\d+)\s+\w+\s+([0-9a-f]+)\t/)
    if (!match)
      return yield* new OperationError({
        operation: "restore",
        directory: repository.worktree,
        message: `Invalid tree entry for ${file}`,
      })
    return { mode: match[1], object: match[2] }
  })

  const preview = Effect.fn("Git.tree.preview")(
    (input: {
      repository: Repository
      current: TreeID
      files: ReadonlyMap<RelativePath, TreeID>
      context?: number
    }) =>
      deps.locked(
        input.repository,
        Effect.gen(function* () {
          const index = path.join(input.repository.gitDirectory, `preview-${randomUUID()}.index`)
          const env = { GIT_INDEX_FILE: index }
          return yield* Effect.gen(function* () {
            yield* repositoryOperation("diff", input.repository, ["read-tree", input.current], { env })
            yield* Effect.forEach(
              input.files,
              ([file, tree]) =>
                Effect.gen(function* () {
                  const source = yield* entry(input.repository, tree, file)
                  if (!source) {
                    yield* repositoryOperation(
                      "diff",
                      input.repository,
                      ["update-index", "--force-remove", "--", file],
                      { env },
                    )
                    return
                  }
                  yield* repositoryOperation(
                    "diff",
                    input.repository,
                    ["update-index", "--add", "--cacheinfo", source.mode, source.object, file],
                    { env },
                  )
                }),
              { discard: true },
            )
            const target = TreeID.make(
              (yield* repositoryOperation("diff", input.repository, ["write-tree"], { env })).text.trim(),
            )
            return yield* treeDiff({
              repository: input.repository,
              from: input.current,
              to: target,
              context: input.context,
              paths: Array.from(input.files.keys()),
            })
          }).pipe(Effect.ensuring(deps.fs.remove(index).pipe(Effect.catch(() => Effect.void))))
        }),
      ),
  )

  const restore = Effect.fn("Git.tree.restore")(
    (input: { repository: Repository; files: ReadonlyMap<RelativePath, TreeID> }) =>
      deps.locked(
        input.repository,
        Effect.forEach(
          input.files,
          ([file, tree]) =>
            Effect.gen(function* () {
              if (yield* entry(input.repository, tree, file)) {
                yield* repositoryOperation("restore", input.repository, ["checkout", tree, "--", file])
                return
              }
              yield* deps.fs
                .remove(path.join(input.repository.worktree, file), { recursive: true, force: true })
                .pipe(
                  Effect.mapError(
                    (cause) =>
                      new OperationError({
                        operation: "restore",
                        directory: input.repository.worktree,
                        message: `Failed to remove ${file}`,
                        cause,
                      }),
                  ),
                )
            }),
          { discard: true },
        ),
      ),
  )

  const checkoutTree = Effect.fn("Git.tree.checkout")((input: { repository: Repository; tree: TreeID }) =>
    deps.locked(
      input.repository,
      Effect.gen(function* () {
        yield* repositoryOperation("restore", input.repository, ["read-tree", input.tree])
        yield* repositoryOperation("restore", input.repository, ["checkout-index", "--all", "--force"])
      }),
    ),
  )

  return {
    refresh,
    ignored,
    writeTree,
    captureTree,
    treeFiles,
    treeDiff,
    preview,
    restore,
    checkoutTree,
  }
}
