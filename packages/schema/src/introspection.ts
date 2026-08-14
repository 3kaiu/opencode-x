export * as IntrospectionSchema from "./introspection"
import { Schema } from "effect"
import { optional } from "./schema"

export interface DecisionRecord extends Schema.Schema.Type<typeof DecisionRecord> {}
export const DecisionRecord = Schema.Struct({
  turn: Schema.Number,
  contextFingerprint: Schema.String,
  action: Schema.Struct({
    tool: Schema.String,
    args: Schema.Unknown,
    decision: Schema.String,
  }),
  result: Schema.Struct({
    outcome: Schema.Union([
      Schema.Literal("success"),
      Schema.Literal("failure"),
    ]),
    errorFingerprint: Schema.String.pipe(optional),
  }),
  seq: Schema.Number,
}).annotate({ identifier: "Introspection.DecisionRecord" })

export type RootCause = Schema.Schema.Type<typeof RootCause>
export const RootCause = Schema.Union([
  Schema.Literal("missing-context"),
  Schema.Literal("tool-misuse"),
  Schema.Literal("stale-assumption"),
  Schema.Literal("model-limit"),
]).annotate({ identifier: "Introspection.RootCause" })

export interface AttributionChain extends Schema.Schema.Type<typeof AttributionChain> {}
export const AttributionChain = Schema.Struct({
  failureSeq: Schema.Number,
  chain: Schema.Array(
    Schema.Struct({
      seq: Schema.Number,
      hypothesis: Schema.String,
    }),
  ),
  rootCause: RootCause,
  lesson: Schema.String.pipe(optional),
}).annotate({ identifier: "Introspection.AttributionChain" })

export interface IntrospectionStore extends Schema.Schema.Type<typeof IntrospectionStore> {}
export const IntrospectionStore = Schema.Struct({
  records: Schema.Array(DecisionRecord),
}).annotate({ identifier: "Introspection.IntrospectionStore" })
