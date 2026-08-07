import { Schema } from "effect"
import { optional } from "./schema"

export interface LogEntry extends Schema.Schema.Type<typeof LogEntry> {}
export const LogEntry = Schema.Struct({
  timestamp: Schema.Number,
  level: Schema.Literals(["TRACE", "DEBUG", "INFO", "WARN", "ERROR", "FATAL"]),
  service: Schema.Literal("opencode-x"),
  package: Schema.String,
  module: Schema.String,
  function: Schema.String,
  traceId: Schema.String,
  spanId: Schema.String,
  sessionId: Schema.String,
  agentId: optional(Schema.String),
  workflowId: optional(Schema.String),
  taskId: optional(Schema.String),
  duration: optional(Schema.Number),
  status: Schema.Literals(["success", "failure", "blocked", "canceled"]),
  error: optional(Schema.String),
  metadata: optional(Schema.Record(Schema.String, Schema.Json)),
}).annotate({ identifier: "Observability.LogEntry" })
