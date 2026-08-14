import { Session } from "@opencode-ai/core/session"
import type { SessionMessage } from "@opencode-ai/core/session/message"
import { effectCmd, fail } from "../effect-cmd"
import { UI } from "../ui"
import * as prompts from "@clack/prompts"
import { EOL } from "os"
import { DateTime, Effect } from "effect"

function redact(kind: string, id: string, value: string) {
  return value.trim() ? `[redacted:${kind}:${id}]` : value
}

function sanitizeMessage(message: SessionMessage.Message): SessionMessage.Message {
  if (message.type === "user") {
    return {
      ...message,
      text: redact("text", message.id, message.text),
      files: message.files?.map((file) => ({ ...file, uri: redact("file-uri", message.id, file.uri) })),
    }
  }
  if (message.type === "assistant") {
    return {
      ...message,
      content: message.content.map((content) => {
        if (content.type === "text") return { ...content, text: redact("text", message.id, content.text) }
        if (content.type === "reasoning") return { ...content, text: redact("reasoning", message.id, content.text) }
        return content
      }),
    }
  }
  return message
}

export const ExportCommand = effectCmd({
  command: "export [sessionID]",
  describe: "export session data as JSON",
  builder: (yargs) =>
    yargs
      .positional("sessionID", {
        describe: "session id to export",
        type: "string",
      })
      .option("sanitize", {
        describe: "redact sensitive transcript and file data",
        type: "boolean",
      }),
  handler: Effect.fn("Cli.export")(function* (args) {
    return yield* run(args)
  }),
})

const run = Effect.fn("Cli.export.body")(function* (args: { sessionID?: string; sanitize?: boolean }) {
  const svc = yield* Session.Service
  let sessionID = args.sessionID ? Session.ID.make(args.sessionID) : undefined
  process.stderr.write(`Exporting session: ${sessionID ?? "latest"}\n`)

  if (!sessionID) {
    UI.empty()
    prompts.intro("Export session", { output: process.stderr })

    const sessions = yield* svc.list()

    if (sessions.length === 0) {
      prompts.log.error("No sessions found", { output: process.stderr })
      prompts.outro("Done", { output: process.stderr })
      return
    }

    sessions.sort(
      (a, b) => DateTime.toEpochMillis(b.time.updated) - DateTime.toEpochMillis(a.time.updated),
    )

    const selectedSession = yield* Effect.promise(() =>
      prompts.autocomplete({
        message: "Select session to export",
        maxItems: 10,
        options: sessions.map((session) => ({
          label: session.title,
          value: session.id,
          hint: `${new Date(DateTime.toEpochMillis(session.time.updated)).toLocaleString()} • ${session.id.slice(-8)}`,
        })),
        output: process.stderr,
      }),
    )

    if (prompts.isCancel(selectedSession)) {
      return yield* Effect.die(new UI.CancelledError())
    }

    sessionID = selectedSession

    prompts.outro("Exporting session...", { output: process.stderr })
  }

  return yield* Effect.gen(function* () {
    const sessionInfo = yield* svc.get(sessionID!)
    const messages = yield* svc.messages({ sessionID: sessionInfo.id })

    const exportData = { info: sessionInfo, messages }

    process.stdout.write(JSON.stringify(args.sanitize ? sanitizeExport(exportData) : exportData, null, 2))
    process.stdout.write(EOL)
  }).pipe(
    Effect.catchTag("Session.NotFoundError", () => fail(`Session not found: ${sessionID!}`)),
    Effect.catchTag("Session.MessageDecodeError", () => fail(`Failed to decode session messages`)),
  )
})

function sanitizeExport(data: { info: Session.Info; messages: SessionMessage.Message[] }) {
  return {
    info: {
      ...data.info,
      title: redact("session-title", data.info.id, data.info.title),
      location: {
        ...data.info.location,
        directory: redact("session-directory", data.info.id, data.info.location.directory),
      },
    },
    messages: data.messages.map(sanitizeMessage),
  }
}