import { Effect, Layer } from "effect"
import { Database } from "@opencode-ai/core/database/database"

// Exercise the production Database layer (pragmas + migrations) so the concurrent
// bootstrap test covers the real startup path rather than a hand-rolled one.
await Effect.runPromise(Effect.scoped(Layer.build(Database.layerFromPath(process.argv[2]!))))
