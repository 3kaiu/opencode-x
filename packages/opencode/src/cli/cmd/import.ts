import { SessionV2 } from "@opencode-ai/core/session"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { SessionMessageTable } from "@opencode-ai/core/session/sql"
import { Location } from "@opencode-ai/schema/location"
import { CliError, effectCmd } from "../effect-cmd"
import { Database } from "@opencode-ai/core/database/database"
import { InstanceRef } from "@/effect/instance-ref"
import { EOL } from "os"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { DateTime, Effect, Schema } from "effect"
import type { InstanceContext } from "@/project/instance-context"

const decodeSessionInfo = Schema.decodeUnknownSync(SessionV2.Info)
const decodeMessage = Schema.decodeUnknownSync(SessionMessage.Message)
const encodeMessage = Schema.encodeSync(SessionMessage.Message)

export function formatImportFileError(file: string, error: FSUtil.Error) {
  if (error._tag === "PlatformError") {
    if (error.reason._tag === "NotFound") return `File not found: ${file}`
    if (error.reason._tag === "PermissionDenied") return `Failed to read file: Permission denied`
    return `Failed to read file: ${error.message}`
  }

  const detail = error.cause instanceof Error ? error.cause.message : error.message
  return `Invalid JSON in ${file}: ${detail}`
}

type ExportData = { info: (typeof SessionV2.Info)["Type"]; messages: SessionMessage.Message[] }

export const ImportCommand = effectCmd({
  command: "import <file>",
  describe: "import session data from JSON file",
  builder: (yargs) =>
    yargs.positional("file", {
      describe: "path to JSON file",
      type: "string",
      demandOption: true,
    }),
  handler: Effect.fn("Cli.import")(function* (args) {
    const ctx = yield* InstanceRef
    if (!ctx) return yield* Effect.die("InstanceRef not provided")
    return yield* runImport(args.file, ctx)
  }),
})

const runImport = Effect.fn("Cli.import.body")(function* (file: string, ctx: InstanceContext) {
  const fs = yield* FSUtil.Service
  const { db } = yield* Database.Service
  const svc = yield* SessionV2.Service

  const exportData = (yield* fs
    .readJson(file)
    .pipe(Effect.mapError((error) => new CliError({ message: formatImportFileError(file, error) })))) as ExportData

  if (!exportData) {
    process.stdout.write(`Failed to read session data`)
    process.stdout.write(EOL)
    return
  }

  const info = decodeSessionInfo({
    ...exportData.info,
    location: Location.Ref.make(ctx.directory as never),
  })

  // Adopt the session (create yields the same id when present, otherwise conflict is a no-op).
  yield* svc
    .create({ id: info.id, title: info.title, location: Location.Ref.make({ directory: ctx.directory as never }) })
    .pipe(Effect.catch(() => Effect.void))

  let seq = 0
  for (const msg of exportData.messages) {
    const encoded = encodeMessage(decodeMessage(msg))
    const { id, type, ...data } = encoded
    yield* db
      .insert(SessionMessageTable)
      .values({
        id,
        session_id: info.id,
        type,
        seq: seq++,
        time_created: DateTime.toEpochMillis(decodeMessage(msg).time as never),
        data,
      } as never)
      .onConflictDoNothing()
      .run()
      .pipe(Effect.orDie)
  }

  process.stdout.write(`Imported session: ${exportData.info.id}`)
  process.stdout.write(EOL)
})