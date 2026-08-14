export * as Planning from "./planning"
import { Schema } from "effect"
import { optional } from "./schema"

export const TaskStatus = Schema.Union([
  Schema.Literal("pending"),
  Schema.Literal("in_progress"),
  Schema.Literal("blocked"),
  Schema.Literal("done"),
  Schema.Literal("cancelled"),
]).annotate({ identifier: "Planning.TaskStatus" })
export type TaskStatus = Schema.Schema.Type<typeof TaskStatus>

export const PlanNode = Schema.Struct({
  id: Schema.String,
  parentID: Schema.Union([Schema.String, Schema.Null]),
  title: Schema.String,
  goal: Schema.String,
  acceptanceCriteria: Schema.Array(Schema.String),
  status: TaskStatus,
  dependsOn: Schema.Array(Schema.String),
  budget: Schema.Struct({
    maxTokens: Schema.Number.pipe(optional),
    maxDurationMs: Schema.Number.pipe(optional)
  }).pipe(optional),
  spent: Schema.Struct({
    tokens: Schema.Number,
    durationMs: Schema.Number
  }),
  checkpoint: Schema.Boolean
}).annotate({ identifier: "Planning.PlanNode" })
export interface PlanNode extends Schema.Schema.Type<typeof PlanNode> {}

export const DriftKind = Schema.Union([
  Schema.Literal("minor"),
  Schema.Literal("moderate"),
  Schema.Literal("severe"),
]).annotate({ identifier: "Planning.DriftKind" })
export type DriftKind = Schema.Schema.Type<typeof DriftKind>

export const Drift = Schema.Struct({
  kind: DriftKind,
  detail: Schema.String,
  suggested: Schema.Union([
    Schema.Literal("ignore"),
    Schema.Literal("note"),
    Schema.Literal("replan"),
    Schema.Literal("ask-user"),
  ])
}).annotate({ identifier: "Planning.Drift" })
export interface Drift extends Schema.Schema.Type<typeof Drift> {}

export interface PlanStore {
  readonly root: PlanNode | null
  readonly nodes: ReadonlyMap<string, PlanNode>
}

export const GoalStatus = Schema.Union([
  Schema.Literal("pending"),
  Schema.Literal("active"),
  Schema.Literal("completed"),
  Schema.Literal("failed"),
  Schema.Literal("abandoned"),
]).annotate({ identifier: "Planning.GoalStatus" })
export type GoalStatus = Schema.Schema.Type<typeof GoalStatus>

export interface Goal {
  readonly id: string
  readonly statement: string
  readonly status: GoalStatus
  readonly createdAt: number
  readonly startedAt?: number
  readonly finishedAt?: number
  readonly plan: PlanStore
  readonly scopedPaths: ReadonlyArray<string>
}

export const AutoGoalDecision = Schema.Struct({
  shouldActivateGoal: Schema.Boolean,
  confidence: Schema.Number,
  reasoning: Schema.String
}).annotate({ identifier: "Planning.AutoGoalDecision" })
export interface AutoGoalDecision extends Schema.Schema.Type<typeof AutoGoalDecision> {}
