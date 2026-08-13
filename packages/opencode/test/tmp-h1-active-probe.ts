// Temporary batch-H probe: timeline of V2 events vs session.active during a
// tool continuation (delete after diagnosis).
import path from "node:path"
import os from "node:os"
import fs from "node:fs"
import { Effect } from "effect"
import { TestLLMServer } from "./lib/llm-server"
import { reply } from "./lib/llm-server"
import { testProviderConfig } from "./lib/test-provider"

const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "h1-active-")))
process.env["OPENCODE_TEST_HOME"] = home
process.env["HOME"] = home
process.env["XDG_CONFIG_HOME"] = path.join(home, ".config")
process.env["XDG_DATA_HOME"] = path.join(home, ".local/share")
process.env["XDG_STATE_HOME"] = path.join(home, ".local/state")
process.env["XDG_CACHE_HOME"] = path.join(home, ".cache")
process.env["OPENCODE_DISABLE_PROJECT_CONFIG"] = "1"
process.env["OPENCODE_PURE"] = "1"
process.env["OPENCODE_DISABLE_AUTOUPDATE"] = "1"
process.env["OPENCODE_DISABLE_AUTOCOMPACT"] = "1"
process.env["OPENCODE_DISABLE_MODELS_FETCH"] = "1"
process.env["OPENCODE_AUTH_CONTENT"] = "{}"

const t0 = Date.now()
const stamp = () => `+${Date.now() - t0}ms`

const main = Effect.gen(function* () {
  const llm = yield* TestLLMServer
  yield* llm.push(
    reply()
      .text("  before tool  ")
      .tool("bash", { command: "printf tool-output", description: "Print deterministic output" }),
  )
  yield* llm.text("  after tool  ")

  const prompt = "use a tool"
  process.env["OPENCODE_CONFIG_CONTENT"] = JSON.stringify({
    ...testProviderConfig(llm.url),
    permission: { bash: "ask" },
  })
  const { Server } = yield* Effect.promise(() => import("../src/server/server"))
  const { createOpencodeClient } = yield* Effect.promise(() => import("@opencode-ai/sdk/v2"))
  const directory = home
  process.chdir(home)
  const fetchFn = ((input: RequestInfo | URL, init?: RequestInit) =>
    Server.Default().app.fetch(new Request(new Request(input, init)))) as typeof globalThis.fetch
  const sdk = createOpencodeClient({ baseUrl: "http://opencode.internal", fetch: fetchFn, directory })

  const created = yield* Effect.promise(() =>
    sdk.v2.session.create({ location: { directory }, model: { providerID: "test", id: "test-model" } }),
  )
  const sessionID = (created.data as { data: { id: string } }).data.id
  console.log(`[probe] ${stamp()} session=${sessionID}`)

  const events = yield* Effect.promise(() => sdk.event.subscribe())
  const iter = events.stream[Symbol.asyncIterator]()
  void (async () => {
    while (true) {
      const next = await iter.next()
      if (next.done) {
        console.log(`[probe] ${stamp()} STREAM DONE`)
        return
      }
      const event = next.value as {
        type: string
        properties?: { sessionID?: string; error?: { message?: string; name?: string } }
      }
      const err = event.properties?.error?.message ?? ""
      console.log(
        `[probe] ${stamp()} EVENT ${event.type} sid=${event.properties?.sessionID === sessionID ? "match" : event.properties?.sessionID ?? "-"}${err ? ` error=${JSON.stringify(err)}` : ""}`,
      )
    }
  })()

  let lastActive: string | undefined
  const poll = setInterval(async () => {
    const out = await sdk.v2.session.active()
    const data = ((out.data ?? {}) as { data?: Record<string, unknown> }).data ?? {}
    const state = data[sessionID] ? "active" : "idle"
    if (state !== lastActive) {
      console.log(`[probe] ${stamp()} ACTIVE->${state}`)
      lastActive = state
    }
  }, 50)

  yield* Effect.sleep("400 millis")
  console.log(`[probe] ${stamp()} prompting`)
  const result = yield* Effect.promise(() => sdk.v2.session.prompt({ sessionID, prompt: { text: prompt } }))
  console.log(`[probe] ${stamp()} prompt returned error=${JSON.stringify(result.error ?? null)}`)
  yield* Effect.sleep("1 seconds")

  const asked = yield* Effect.promise(() => sdk.v2.session.permission.list({ sessionID }))
  console.log(`[probe] ${stamp()} permission list=${JSON.stringify(asked.data ?? null)}`)
  const req = ((asked.data ?? {}) as { data?: Array<{ id: string }> }).data?.[0]
  if (req) {
    const replied = yield* Effect.promise(() =>
      sdk.v2.session.permission.reply({ sessionID, requestID: req.id, reply: "reject" }),
    )
    console.log(`[probe] ${stamp()} replied reject=${JSON.stringify(replied.error ?? null)}`)
  }
  yield* Effect.sleep("2 seconds")
  clearInterval(poll)
  const hits = yield* llm.hits
  const calls = yield* llm.calls
  console.log(`[probe] ${stamp()} llm calls=${calls}`)
  const inputs = yield* llm.inputs
  console.log(
    `[probe] ${stamp()} llm inputs=${JSON.stringify(
      inputs.map((body) => ({
        model: body.model,
        messages: (body.messages as Array<{ role?: string }>)?.length,
        tools: (body.tools as Array<unknown>)?.length,
        n: body.n,
      })),
    )}`,
  )
  const msgs = yield* Effect.promise(() => sdk.v2.session.messages({ sessionID }))
  console.log(`[probe] ${stamp()} messages data=${JSON.stringify(msgs.data ?? null)}`)
}).pipe(Effect.provide(TestLLMServer.layer), Effect.scoped)

await Effect.runPromise(main)
process.exit(0)
