import { describe, expect, test } from "bun:test"
import { Model } from "@opencode-ai/llm"
import * as OpenAIChat from "@opencode-ai/llm/protocols/openai-chat"
import { DateTime } from "effect"
import { SessionMessage } from "../src/session/message"
import { toLLMMessages } from "../src/session/runner/to-llm-message"

const model = Model.make({ id: "fake-model", provider: "fake", route: OpenAIChat.route })

describe("toLLMMessages agents delegation hint", () => {
  test("user message without agents stays unchanged", () => {
    const user = SessionMessage.User.make({
      id: "msg_plain",
      type: "user",
      text: "plain prompt",
      time: { created: DateTime.makeUnsafe(0) },
    })
    const [message] = toLLMMessages([user], model)
    expect(message.role).toBe("user")
    if (message.role !== "user") return
    const texts = message.content.filter((part) => part.type === "text").map((part) => (part.type === "text" ? part.text : ""))
    expect(texts).toEqual(["plain prompt"])
  })

  test("user message with agents gets a delegate_task guidance part", () => {
    const user = SessionMessage.User.make({
      id: "msg_agents",
      type: "user",
      text: "research this",
      agents: [{ name: "explore" }],
      time: { created: DateTime.makeUnsafe(0) },
    })
    const [message] = toLLMMessages([user], model)
    if (message.role !== "user") throw new Error("expected user message")
    const text = message.content
      .filter((part) => part.type === "text")
      .map((part) => (part.type === "text" ? part.text : ""))
      .join("\n")
    expect(text).toContain("research this")
    expect(text).toContain("delegate_task")
    expect(text).toContain("explore")
  })
})
