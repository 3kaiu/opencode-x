/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { tmpdir } from "../../../fixture/fixture"
import { directory, json, mount, wait } from "./sync-fixture"

const sessionID = "ses_hydration_v2"
const sessionInfo = {
  id: sessionID,
  projectID: "proj_test",
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created: 0, updated: 0 },
  title: "v2 hydration",
  location: { directory },
}

function assistant(id: string, text: string) {
  return {
    id,
    type: "assistant",
    agent: "build",
    model: { id: "model", providerID: "provider" },
    content: [{ type: "text", id: `text_${id}`, text }],
    time: { created: 1, completed: 2 },
  }
}

function mountWith(messages: () => unknown[]) {
  return mount((url) => {
    if (url.pathname === `/api/session/${sessionID}`) return json({ data: sessionInfo })
    if (url.pathname === `/api/session/${sessionID}/messages`) return json({ data: messages() })
    if (url.pathname === `/api/session/${sessionID}/todo`) return json({ data: [] })
    return undefined
  })
}

test("hydrates the full message window from the v2 messages endpoint", async () => {
  await using tmp = await tmpdir()
  await Bun.write(`${tmp.path}/kv.json`, "{}")

  const all = Array.from({ length: 100 }, (_, index) => assistant(`msg_${String(index).padStart(3, "0")}`, `text ${index}`))
  // The messages endpoint returns newest-first (reverse-chrono); convertV2Messages
  // restores chrono order into the V1 store.
  const { app, sync } = await mountWith(() => [...all].reverse())

  try {
    await sync.session.sync(sessionID)

    expect(sync.data.message[sessionID]).toHaveLength(100)
    expect(sync.data.message[sessionID].at(-1)?.id).toBe("msg_099")
    const part = sync.data.part["msg_000"]?.[0]
    expect(part).toMatchObject({ type: "text", text: "text 0" })
  } finally {
    app.renderer.destroy()
  }
})

test("cleans up parts when a message disappears from history", async () => {
  await using tmp = await tmpdir()
  await Bun.write(`${tmp.path}/kv.json`, "{}")

  const messages = [assistant("msg_a", "a"), assistant("msg_b", "b")]
  const { app, sync } = await mountWith(() => [...messages].reverse())

  try {
    await sync.session.sync(sessionID)
    expect(sync.data.part["msg_a"]?.[0]).toMatchObject({ text: "a" })
    expect(sync.data.part["msg_b"]?.[0]).toMatchObject({ text: "b" })

    messages.length = 1
    await sync.session.sync(sessionID)

    expect(sync.data.message[sessionID]?.map((m) => m.id)).toEqual(["msg_a"])
    expect(sync.data.part["msg_a"]?.[0]).toMatchObject({ text: "a" })
    expect(sync.data.part["msg_b"]).toBeUndefined()
  } finally {
    app.renderer.destroy()
  }
})
