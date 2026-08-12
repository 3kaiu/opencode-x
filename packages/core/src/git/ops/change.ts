import path from "path"
import { Effect, Stream } from "effect"
import { ChildProcess } from "effect/unstable/process"
import { AbsolutePath } from "../../schema"
import type { AppProcess } from "../../process"
import { ChangeSet, PatchError, Repository } from "../schema"
import { execute } from "../process"

export type ChangeOps = ReturnType<typeof makeChangeOps>

export const makeChangeOps = (deps: { readonly proc: AppProcess.Interface }) => {
  const capture = Effect.fn("Git.change.capture")(function* (input: { repository: Repository; path: AbsolutePath }) {
    const scope = path.relative(input.repository.worktree, input.path).replaceAll("\\", "/") || "."
    const tracked = yield* execute(
      input.repository.worktree,
      deps.proc,
    )(["diff", "--binary", "HEAD", "--", scope]).pipe(
      Effect.mapError(
        (cause) => new PatchError({ operation: "capture", directory: input.path, message: cause.message, cause }),
      ),
    )
    if (tracked.exitCode !== 0) {
      return yield* new PatchError({
        operation: "capture",
        directory: input.path,
        message: tracked.stderr.trim() || tracked.text.trim() || "Failed to capture tracked changes",
      })
    }

    const untracked = yield* execute(
      input.repository.worktree,
      deps.proc,
    )(["ls-files", "--others", "--exclude-standard", "-z", "--", scope]).pipe(
      Effect.mapError(
        (cause) => new PatchError({ operation: "capture", directory: input.path, message: cause.message, cause }),
      ),
    )
    if (untracked.exitCode !== 0) {
      return yield* new PatchError({
        operation: "capture",
        directory: input.path,
        message: untracked.stderr.trim() || untracked.text.trim() || "Failed to list untracked changes",
      })
    }

    const created = yield* Effect.forEach(untracked.text.split("\0").filter(Boolean), (file) =>
      execute(
        input.repository.worktree,
        deps.proc,
      )(["diff", "--binary", "--no-index", "--", "/dev/null", file]).pipe(
        Effect.mapError(
          (cause) => new PatchError({ operation: "capture", directory: input.path, message: cause.message, cause }),
        ),
        Effect.flatMap((result) =>
          // git diff --no-index returns 1 when differences were found.
          result.exitCode === 0 || result.exitCode === 1
            ? Effect.succeed(result.text)
            : Effect.fail(
                new PatchError({
                  operation: "capture",
                  directory: input.path,
                  message:
                    result.stderr.trim() || result.text.trim() || `Failed to capture untracked change: ${file}`,
                }),
              ),
        ),
      ),
    )
    return ChangeSet.make([tracked.text, ...created].filter(Boolean).join("\n"))
  })

  const apply = Effect.fn("Git.change.apply")(function* (input: {
    repository: Repository
    path: AbsolutePath
    changes: ChangeSet
  }) {
    const result = yield* deps.proc
      .run(
        ChildProcess.make("git", ["apply", "-"], {
          cwd: input.path,
          extendEnv: true,
          stdin: Stream.make(new TextEncoder().encode(input.changes)),
        }),
      )
      .pipe(
        Effect.mapError(
          (cause) => new PatchError({ operation: "apply", directory: input.path, message: cause.message, cause }),
        ),
      )
    if (result.exitCode === 0) return
    return yield* new PatchError({
      operation: "apply",
      directory: input.path,
      message:
        result.stderr.toString("utf8").trim() || result.stdout.toString("utf8").trim() || "Failed to apply changes",
    })
  })

  const discard = Effect.fn("Git.change.discard")(function* (input: {
    repository: Repository
    path: AbsolutePath
    index: "preserve" | "reset"
    untracked: "preserve" | "remove"
  }) {
    const scope = path.relative(input.repository.worktree, input.path).replaceAll("\\", "/") || "."
    const restore = yield* execute(
      input.repository.worktree,
      deps.proc,
    )(input.index === "reset" ? ["checkout", "HEAD", "--", scope] : ["checkout", "--", scope]).pipe(
      Effect.mapError(
        (cause) => new PatchError({ operation: "reset", directory: input.path, message: cause.message, cause }),
      ),
    )
    if (restore.exitCode !== 0) {
      return yield* new PatchError({
        operation: "reset",
        directory: input.path,
        message: restore.stderr.trim() || restore.text.trim() || "Failed to restore tracked changes",
      })
    }
    if (input.untracked === "preserve") return
    const clean = yield* execute(
      input.repository.worktree,
      deps.proc,
    )(["clean", "-fd", "--", scope]).pipe(
      Effect.mapError(
        (cause) => new PatchError({ operation: "reset", directory: input.path, message: cause.message, cause }),
      ),
    )
    if (clean.exitCode === 0) return
    return yield* new PatchError({
      operation: "reset",
      directory: input.path,
      message: clean.stderr.trim() || clean.text.trim() || "Failed to clean untracked changes",
    })
  })

  return { capture, apply, discard }
}