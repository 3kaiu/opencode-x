import { expect, test } from "bun:test"
import { SessionCompaction } from "@opencode-ai/core/session/compaction"

test("compaction prompt preserves detailed work state and relevant files", () => {
  const prompt = SessionCompaction.buildPrompt({ context: ["conversation history"] })

  expect(prompt).toContain("## Work State\n### Completed")
  expect(prompt).toContain("### Active")
  expect(prompt).toContain("### Blocked")
  expect(prompt).toContain("## Relevant Files")
})

test("compaction prompt anchors the current todo list state", () => {
  const prompt = SessionCompaction.buildPrompt({
    context: ["conversation history"],
    todos: [
      { content: "Wire memory injection", status: "completed", priority: "high" },
      { content: "Anchored summary", status: "in_progress", priority: "high" },
      { content: "Polish TUI", status: "pending", priority: "low" },
    ],
  })

  expect(prompt).toContain("## Current Todo List State")
  expect(prompt).toContain("- [completed] Wire memory injection (high)")
  expect(prompt).toContain("- [in_progress] Anchored summary (high)")
  expect(prompt).toContain("- [pending] Polish TUI (low)")
})

test("compaction prompt omits the todo section when empty", () => {
  const prompt = SessionCompaction.buildPrompt({ context: ["conversation history"], todos: [] })

  expect(prompt).not.toContain("## Current Todo List State")
})

test("compaction describes tool media without embedding base64", () => {
  const base64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB"
  const serialized = SessionCompaction.serializeToolContent([
    { type: "text", text: "Image read successfully" },
    {
      type: "file",
      uri: `data:image/png;base64,${base64}`,
      mime: "image/png",
      name: "pixel.png",
    },
  ])

  expect(serialized).toBe("Image read successfully\n[Attached image/png: pixel.png]")
  expect(serialized).not.toContain(base64)
})
