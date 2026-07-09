export * as CompressPlugin from "./index"

import { define } from "../internal"
import { Effect, Schema } from "effect"
import { requestCompaction } from "../../compaction-request"

export const Plugin = define({
  id: "compress",
  effect: Effect.fn(function* (ctx) {
    yield* ctx.tool.register({
      compress: {
        description: "Compress the conversation history into a concise summary to reduce token usage. Call this when the conversation is getting long or you need to free up context window space. The compression preserves all key facts, decisions, file paths, and work state.",
        input: Schema.Struct({
          preserve: Schema.optional(Schema.Array(Schema.String)),
        }),
        output: Schema.String,
        execute: (input, toolCtx) =>
          Effect.gen(function* () {
            yield* requestCompaction
            return `Compaction triggered for session ${toolCtx.sessionID}. The conversation will be compacted before the next assistant response.${input.preserve && input.preserve.length > 0 ? ` Preserving: ${input.preserve.join(", ")}` : ""}`
          }),
      },
    })
  }),
})
