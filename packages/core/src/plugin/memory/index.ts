export * as MemoryPlugin from "./index"

import { define } from "../internal"
import { Effect, Exit, Queue, Ref, Schema } from "effect"
import { Global } from "../../global"
import { FSUtil } from "../../fs-util"
import path from "path"

const MemoryEntry = Schema.Struct({
  name: Schema.String,
  content: Schema.String,
  tags: Schema.optional(Schema.Array(Schema.String)),
  created: Schema.Number,
  updated: Schema.Number,
})

type MemoryEntry = Schema.Schema.Type<typeof MemoryEntry>

const MemoryStore = Schema.Struct({
  entries: Schema.Array(MemoryEntry),
})

type Entry = { name: string; content: string; tags: string[]; created: number; updated: number }

const memoryPath = () => {
  const { state } = Global.Path
  return path.join(state, "memory.json")
}

const fromDecoded = (entries: ReadonlyArray<MemoryEntry>): Array<Entry> =>
  entries.map((e) => ({
    name: e.name,
    content: e.content,
    tags: [...(e.tags ?? [])],
    created: e.created,
    updated: e.updated,
  }))

export const Plugin = define({
  id: "memory",
  effect: Effect.fn(function* (ctx) {
    const fs = yield* FSUtil.Service

    const raw = yield* fs.readFileStringSafe(memoryPath()).pipe(Effect.orDie)
    const initial = raw
      ? fromDecoded(Schema.decodeUnknownSync(MemoryStore)(JSON.parse(raw)).entries)
      : []
    const store = yield* Ref.make(initial)
    const writes = yield* Queue.unbounded<ReadonlyArray<Entry>>()

    yield* Effect.forkScoped(
      Effect.gen(function* () {
        while (true) {
          const entries = yield* Queue.take(writes)
          yield* fs.writeJson(memoryPath(), { entries }).pipe(Effect.orDie)
        }
      }),
    )

    yield* Effect.addFinalizer((_exit: Exit.Exit<unknown, unknown>) =>
      Effect.gen(function* () {
        const entries = yield* Ref.get(store)
        if (entries.length === 0) return
        yield* fs.writeJson(memoryPath(), { entries }).pipe(Effect.orDie)
      }),
    )

    yield* ctx.context.register({
      key: "plugin/memory",
      load: Effect.gen(function* () {
        const entries = yield* Ref.get(store)
        if (entries.length === 0) return ""
        const estimated = (text: string) => Math.ceil(text.length / 4)
        const maxTokens = 2000
        let total = estimated("\n---\n**Stored Memories:**\n")
        const included: string[] = []
        for (const e of entries) {
          const line = `- **${e.name}** (${e.tags.join(", ")}): ${e.content}`
          const tokens = estimated(line)
          if (total + tokens > maxTokens) break
          total += tokens
          included.push(line)
        }
        return `\n---\n**Stored Memories:**\n${included.join("\n")}`
      }),
    })

    yield* ctx.tool.register({
      memorize: {
        description: "Save a named memory for recall across sessions. Use for user preferences, project facts, decisions, and other persistent information.",
        input: Schema.Struct({
          name: Schema.String,
          content: Schema.String,
          tags: Schema.optional(Schema.Array(Schema.String)),
        }),
        output: Schema.String,
        execute: (input) =>
          Effect.gen(function* () {
            const now = Date.now()
            const current = yield* Ref.get(store)
            const existing = current.findIndex((e) => e.name === input.name)
            const entry: Entry = {
              name: input.name,
              content: input.content,
              tags: input.tags ?? [],
              created: existing >= 0 ? current[existing].created : now,
              updated: now,
            }
            if (existing >= 0) {
              current[existing] = entry
            } else {
              current.push(entry)
            }
            yield* Queue.offer(writes, yield* Ref.get(store))
            return `Memorized "${input.name}"`
          }),
      },
      recall: {
        description: "Search stored memories by name or tag. Returns matching memory entries.",
        input: Schema.Struct({
          query: Schema.String,
        }),
        output: Schema.String,
        execute: (input) =>
          Effect.gen(function* () {
            const entries = yield* Ref.get(store)
            const q = input.query.toLowerCase()
            const matches = entries.filter(
              (e) =>
                e.name.toLowerCase().includes(q) ||
                e.content.toLowerCase().includes(q) ||
                e.tags.some((t) => t.toLowerCase().includes(q)),
            )
            if (matches.length === 0) return "No matching memories found."
            return matches
              .map((e) => `- **${e.name}** [${e.tags.join(", ")}]: ${e.content}`)
              .join("\n")
          }),
      },
    })
  }),
})
