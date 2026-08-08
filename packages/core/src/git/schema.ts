import { Schema } from "effect"
import { AbsolutePath } from "../schema"

export class Repository extends Schema.Class<Repository>("Git.Repository")({
  worktree: AbsolutePath,
  gitDirectory: AbsolutePath,
  commonDirectory: AbsolutePath,
}) {}

export const ChangeSet = Schema.String.pipe(Schema.brand("Git.ChangeSet"))
export type ChangeSet = typeof ChangeSet.Type

export const TreeID = Schema.String.pipe(Schema.brand("Git.TreeID"))
export type TreeID = typeof TreeID.Type

export class OperationError extends Schema.TaggedErrorClass<OperationError>()("Git.OperationError", {
  operation: Schema.Literals([
    "clone",
    "fetch",
    "checkout",
    "reset",
    "create",
    "refresh",
    "write_tree",
    "list_files",
    "diff",
    "restore",
  ]),
  message: Schema.String,
  directory: Schema.optional(AbsolutePath),
  cause: Schema.optional(Schema.Defect()),
}) {}

export class Worktree extends Schema.Class<Worktree>("Git.Worktree")({
  directory: AbsolutePath,
  kind: Schema.Literals(["main", "linked"]),
}) {}

export class WorktreeError extends Schema.TaggedErrorClass<WorktreeError>()("Git.WorktreeError", {
  operation: Schema.Literals(["create", "remove", "list"]),
  message: Schema.String,
  directory: Schema.optional(AbsolutePath),
  forceRequired: Schema.optional(Schema.Boolean),
  cause: Schema.optional(Schema.Defect()),
}) {}

export class PatchError extends Schema.TaggedErrorClass<PatchError>()("Git.PatchError", {
  operation: Schema.Literals(["capture", "apply", "reset"]),
  directory: AbsolutePath,
  message: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {}

