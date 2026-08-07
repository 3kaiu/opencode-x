import { Schema } from "effect"
import { optional } from "./schema"

export interface TraceContext extends Schema.Schema.Type<typeof TraceContext> {}
export const TraceContext = Schema.Struct({
  traceId: Schema.String,
  spanId: Schema.String,
  parentSpanId: optional(Schema.String),
  sampled: Schema.Boolean,
  name: Schema.String,
  kind: Schema.Literals(["internal", "client", "server", "producer", "consumer"]),
}).annotate({ identifier: "Observability.TraceContext" })
