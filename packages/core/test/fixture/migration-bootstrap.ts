import { SqliteClient } from "@effect/sql-sqlite-bun"
import { Effect } from "effect"
import { EffectDrizzleSqlite } from "@opencode-ai/effect-drizzle-sqlite"
import { DatabaseMigration } from "@opencode-ai/core/database/migration"

await Effect.runPromise(
  Effect.gen(function* () {
    const db = yield* EffectDrizzleSqlite.makeWithDefaults()
    yield* db.run("PRAGMA journal_mode = WAL")
    yield* db.run("PRAGMA busy_timeout = 5000")
    yield* DatabaseMigration.apply(db)
  }).pipe(Effect.provide(SqliteClient.layer({ filename: process.argv[2]! })), Effect.scoped),
)
