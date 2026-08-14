import { describe, expect, test } from "bun:test"
import type { GlobalEvent, SessionMessage } from "@opencode-ai/sdk/v2/types"
import type { Store } from "../src/context/client"
import { applyEvent } from "../src/context/client"

function store(): Store {
  return { sessions: [], messages: {}, active: undefined }
}

function event(type: string, properties: Record<string, unknown>): GlobalEvent {
  return { directory: "/", payload: { id: `evt_${type}`, type: type as never, properties } }
}

describe("session event projection", () => {
  test("projects a prompt into a user message", () => {
    const s = store()
    applyEvent(s, event("session.next.prompt.admitted", {
      sessionID: "ses_1",
      messageID: "msg_1",
      timestamp: 1,
      prompt: { text: "hello" },
      delivery: "steer",
    }).payload)
    expect(s.messages.ses_1).toEqual([
      { id: "msg_1", type: "user", text: "hello", time: { created: 1 } },
    ])
  })

  test("streams text deltas into the assistant message and completes the tool run", () => {
    const s = store()
    const payloads = [
      {
        type: "session.next.step.started",
        properties: {
          sessionID: "ses_1", assistantMessageID: "msg_a", timestamp: 1,
          agent: "build", model: { id: "m", providerID: "p" },
        },
      },
      {
        type: "session.next.tool.input.started",
        properties: {
          sessionID: "ses_1", assistantMessageID: "msg_a", timestamp: 2, callID: "call_1", name: "bash",
        },
      },
      {
        type: "session.next.tool.called",
        properties: {
          sessionID: "ses_1", assistantMessageID: "msg_a", timestamp: 3, callID: "call_1",
          input: { command: "ls" }, provider: { executed: false, metadata: {} },
          presentation: { card: "terminal", title: "bash ls", cwd: "/tmp" },
        },
      },
      {
        type: "session.next.tool.success",
        properties: {
          sessionID: "ses_1", assistantMessageID: "msg_a", timestamp: 4, callID: "call_1",
          structured: { exit: 0 }, content: [{ type: "text", text: "out" }],
          presentation: { card: "terminal", title: "bash ls", output: "out", exitCode: 0 },
          provider: { executed: true, metadata: {} },
        },
      },
      {
        type: "session.next.text.started",
        properties: {
          sessionID: "ses_1", assistantMessageID: "msg_a", timestamp: 5, textID: "text_1",
        },
      },
      {
        type: "session.next.text.delta",
        properties: {
          sessionID: "ses_1", assistantMessageID: "msg_a", timestamp: 6, textID: "text_1", delta: "part",
        },
      },
      {
        type: "session.next.text.ended",
        properties: {
          sessionID: "ses_1", assistantMessageID: "msg_a", timestamp: 7, textID: "text_1", text: "full",
        },
      },
    ]
    for (const p of payloads) applyEvent(s, event(p.type, p.properties).payload)

    const assistant = s.messages.ses_1[0]
    expect(assistant?.type).toBe("assistant")
    if (assistant?.type !== "assistant") return
    const tool = assistant.content.find((part) => part.type === "tool")
    expect(tool?.type).toBe("tool")
    if (tool?.type !== "tool") return
    expect(tool.state.status).toBe("completed")
    if (tool.state.status !== "completed") return
    expect(tool.state.presentation).toEqual({ card: "terminal", title: "bash ls", output: "out", exitCode: 0 })
    const text = assistant.content.find((part) => part.type === "text")
    expect(text?.type === "text" ? text.text : undefined).toBe("full")
  })

  test("dedupes part creation across replay", () => {
    const s = store()
    const started = event("session.next.tool.input.started", {
      sessionID: "ses_1", assistantMessageID: "msg_a", timestamp: 1, callID: "call_1", name: "read",
    }).payload
    const step = event("session.next.step.started", {
      sessionID: "ses_1", assistantMessageID: "msg_a", timestamp: 0,
      agent: "build", model: { id: "m", providerID: "p" },
    }).payload
    applyEvent(s, step)
    applyEvent(s, started)
    applyEvent(s, started)
    const assistant = s.messages.ses_1[0]
    expect(assistant?.type === "assistant" ? assistant.content.length : -1).toBe(1)
  })

  test("keeps failed tool state with presentation and error", () => {
    const s = store()
    applyEvent(s, event("session.next.step.started", {
      sessionID: "ses_1", assistantMessageID: "msg_a", timestamp: 0,
      agent: "build", model: { id: "m", providerID: "p" },
    }).payload)
    applyEvent(s, event("session.next.tool.input.started", {
      sessionID: "ses_1", assistantMessageID: "msg_a", timestamp: 1, callID: "call_1", name: "bash",
    }).payload)
    applyEvent(s, event("session.next.tool.called", {
      sessionID: "ses_1", assistantMessageID: "msg_a", timestamp: 1, callID: "call_1",
      input: {}, provider: { executed: false, metadata: {} },
      presentation: { card: "terminal", title: "bash ls" },
    }).payload)
    applyEvent(s, event("session.next.tool.failed", {
      sessionID: "ses_1", assistantMessageID: "msg_a", timestamp: 2, callID: "call_1",
      error: { type: "unknown", message: "boom" },
      presentation: { card: "terminal", title: "bash ls", output: "stderr", exitCode: 1 },
      provider: { executed: false, metadata: {} },
    }).payload)
    const tool = s.messages.ses_1[0]?.type === "assistant"
      ? s.messages.ses_1[0].content.find((part) => part.type === "tool")
      : undefined
    expect(tool?.type).toBe("tool")
    if (tool?.type !== "tool") return
    expect(tool.state.status).toBe("error")
    if (tool.state.status !== "error") return
    expect(tool.state.error).toEqual({ type: "unknown", message: "boom" })
    expect(tool.state.presentation?.card).toBe("terminal")
  })
})

describe("projected message ordering", () => {
  test("keeps projected messages in arrival order", () => {
    const s = store()
    applyEvent(s, event("session.next.prompt.admitted", {
      sessionID: "ses_1", messageID: "msg_1", timestamp: 1,
      prompt: { text: "hi" }, delivery: "steer",
    }).payload)
    applyEvent(s, event("session.next.step.started", {
      sessionID: "ses_1", assistantMessageID: "msg_a", timestamp: 2,
      agent: "build", model: { id: "m", providerID: "p" },
    }).payload)
    expect((s.messages.ses_1 as SessionMessage[]).map((m) => m.type)).toEqual(["user", "assistant"])
  })
})