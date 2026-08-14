import { Context, Effect } from "effect"
import { AbsolutePath, RelativePath } from "../schema"
import { File } from "../file"
import {
  ChangeSet,
  OperationError,
  PatchError,
  Repository,
  TreeID,
  Worktree,
  WorktreeError,
} from "./schema"

export interface Interface {
  readonly repo: {
    readonly discover: (input: AbsolutePath) => Effect.Effect<Repository | undefined>
    readonly clone: (input: {
      remote: string
      directory: AbsolutePath
      branch?: string
      depth?: number
    }) => Effect.Effect<Repository, OperationError>
    readonly create: (input: {
      worktree: AbsolutePath
      gitDirectory: AbsolutePath
      seed?: Repository
    }) => Effect.Effect<Repository, OperationError>
  }
  readonly remote: {
    readonly get: (repository: Repository, name?: string) => Effect.Effect<string | undefined>
  }
  readonly history: {
    readonly head: (repository: Repository) => Effect.Effect<string | undefined>
    readonly branch: (repository: Repository) => Effect.Effect<string | undefined>
    readonly defaultRemoteBranch: (repository: Repository, remote?: string) => Effect.Effect<string | undefined>
    readonly rootCommits: (repository: Repository) => Effect.Effect<readonly string[]>
  }
  readonly sync: {
    readonly fetchRemotes: (repository: Repository, input?: { prune?: boolean }) => Effect.Effect<void, OperationError>
    readonly fetchBranch: (
      repository: Repository,
      input: { remote?: string; branch: string; force?: boolean },
    ) => Effect.Effect<void, OperationError>
    readonly checkoutRemoteBranch: (
      repository: Repository,
      input: { remote?: string; branch: string; reset?: boolean },
    ) => Effect.Effect<void, OperationError>
    readonly resetHard: (repository: Repository, revision: string) => Effect.Effect<void, OperationError>
  }
  readonly change: {
    readonly capture: (input: { repository: Repository; path: AbsolutePath }) => Effect.Effect<ChangeSet, PatchError>
    readonly apply: (input: {
      repository: Repository
      path: AbsolutePath
      changes: ChangeSet
    }) => Effect.Effect<void, PatchError>
    readonly discard: (input: {
      repository: Repository
      path: AbsolutePath
      index: "preserve" | "reset"
      untracked: "preserve" | "remove"
    }) => Effect.Effect<void, PatchError>
  }
  readonly worktree: {
    readonly create: (input: {
      repository: Repository
      directory: AbsolutePath
    }) => Effect.Effect<Repository, WorktreeError>
    readonly remove: (input: {
      repository: Repository
      directory: AbsolutePath
      force: boolean
    }) => Effect.Effect<void, WorktreeError>
    readonly list: (repository: Repository) => Effect.Effect<readonly Worktree[], WorktreeError>
  }
  readonly index: {
    /** Refresh only the requested project-relative scope, preserving all other entries. */
    readonly refresh: (input: {
      repository: Repository
      scope: RelativePath
      ignores?: Repository
      maximumUntrackedFileBytes?: number
    }) => Effect.Effect<{ readonly skipped: readonly RelativePath[] }, OperationError>
    readonly ignored: (input: {
      repository: Repository
      paths: readonly RelativePath[]
    }) => Effect.Effect<ReadonlySet<RelativePath>, OperationError>
  }
  readonly tree: {
    readonly capture: (input: {
      repository: Repository
      scopes: readonly RelativePath[]
      ignores?: Repository
      maximumUntrackedFileBytes?: number
    }) => Effect.Effect<TreeID, OperationError>
    readonly write: (repository: Repository) => Effect.Effect<TreeID, OperationError>
    readonly files: (input: {
      repository: Repository
      from: TreeID
      to: TreeID
    }) => Effect.Effect<readonly RelativePath[], OperationError>
    readonly diff: (input: {
      repository: Repository
      from: TreeID
      to: TreeID
      context?: number
      paths?: readonly RelativePath[]
    }) => Effect.Effect<readonly File.Diff[], OperationError>
    readonly preview: (input: {
      repository: Repository
      current: TreeID
      files: ReadonlyMap<RelativePath, TreeID>
      context?: number
    }) => Effect.Effect<readonly File.Diff[], OperationError>
    readonly restore: (input: {
      repository: Repository
      files: ReadonlyMap<RelativePath, TreeID>
    }) => Effect.Effect<void, OperationError>
    readonly checkout: (input: { repository: Repository; tree: TreeID }) => Effect.Effect<void, OperationError>
  }
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Git") {}
