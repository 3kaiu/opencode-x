export * as MemoryPlugin from "./index"

import { define } from "../internal"
import { Effect, Exit, Queue, Ref, Schema } from "effect"
import { Global } from "../../global"
import { FSUtil } from "../../fs-util"
import { Token } from "../../util/token"
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

const DAY_MS = 24 * 60 * 60 * 1000
const AUTO_EXPIRY_MS = 7 * DAY_MS

const entryOrder = (e: Entry) => {
  if (e.tags.includes("explicit")) return 0
  if (e.tags.includes("session")) return 1
  return 2
}

const alive = (e: Entry) => !e.tags.includes("auto") || Date.now() - e.updated < AUTO_EXPIRY_MS

export const Plugin = define({
  id: "memory",
  effect: Effect.fn(function* (ctx) {
    const fs = yield* FSUtil.Service

    const raw = yield* fs.readFileStringSafe(memoryPath()).pipe(Effect.orDie)
    const decoded = raw ? fromDecoded(Schema.decodeUnknownSync(MemoryStore)(JSON.parse(raw)).entries) : []
    const aliveEntries = decoded.filter(alive)
    const initial = decoded.length !== aliveEntries.length ? aliveEntries : decoded
    if (decoded.length !== aliveEntries.length) yield* fs.writeJson(memoryPath(), { entries: aliveEntries }).pipe(Effect.orDie)
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

    const memoryGuidance =
      "You have access to a persistent memory system. Use `memorize` to save user preferences, project facts, decisions, and other information you want to recall across sessions. Use `recall` to search past memories by topic. Call `recall` at the start of a session or when you encounter a topic that might have been discussed before."

    yield* ctx.context.register({
      key: "plugin/memory",
      load: Effect.gen(function* () {
        const entries = yield* Ref.get(store)
        if (entries.length === 0) return memoryGuidance
        const aliveEntries = entries.filter(alive)
        if (aliveEntries.length === 0) return memoryGuidance
        const sorted = [...aliveEntries].sort((a, b) => {
          const ga = entryOrder(a), gb = entryOrder(b)
          if (ga !== gb) return ga - gb
          return b.updated - a.updated
        })
        const maxTokens = 2000
        const header = `\n---\n**Stored Memories:**\n`
        let total = Token.estimate(memoryGuidance) + Token.estimate(header)
        const included: string[] = []
        for (const e of sorted) {
          const line = `- **${e.name}** (${e.tags.join(", ")}): ${e.content}`
          const tokens = Token.estimate(line)
          if (total + tokens > maxTokens) break
          total += tokens
          included.push(line)
        }
        return `${memoryGuidance}\n${header}${included.join("\n")}`
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
            if (existing >= 0) {
              const prev = current[existing]
              const mergedTags = [...new Set([...prev.tags, ...(input.tags ?? [])])]
              current[existing] = {
                name: input.name,
                content: `${prev.content}\n${input.content}`,
                tags: mergedTags,
                created: prev.created,
                updated: now,
              }
            } else {
              current.push({
                name: input.name,
                content: input.content,
                tags: input.tags ?? [],
                created: now,
                updated: now,
              })
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
            const matches = entries.filter(alive).filter(
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
