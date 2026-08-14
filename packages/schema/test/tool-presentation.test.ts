import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { ToolPresentation } from "../src/tool-presentation"
import { SessionEvent } from "../src/session-event"

const decode = Schema.decodeUnknownSync

describe("tool presentation contract", () => {
  test("call cards decode and encode losslessly with optional fields omitted", () => {
    const call = decode(ToolPresentation.Call)({
      card: "terminal",
      title: "npm test",
      description: "Run the test suite",
      cwd: "/workspace/app",
    })
    expect(call).toEqual({ card: "terminal", title: "npm test", description: "Run the test suite", cwd: "/workspace/app" })
    expect(Schema.encodeSync(ToolPresentation.Call)(call)).toEqual(call)
  })

  test("diff call carries per-file changes with null oldText for new files", () => {
    const call = decode(ToolPresentation.Call)({
      card: "diff",
      title: "Write notes.md",
      diffs: [{ path: "notes.md", oldText: null, newText: "# Notes" }],
    })
    expect(call).toEqual({
      card: "diff",
      title: "Write notes.md",
      diffs: [{ path: "notes.md", oldText: null, newText: "# Notes" }],
    })
  })

  test("generic call with locations and kind", () => {
    const call = decode(ToolPresentation.Call)({
      card: "generic",
      title: "Grep for TODO",
      kind: "search",
      locations: [{ path: "src", line: 3 }],
    })
    expect(call).toEqual({
      card: "generic",
      title: "Grep for TODO",
      kind: "search",
      locations: [{ path: "src", line: 3 }],
    })
  })

  test("read result carries line-numbered window", () => {
    const result = decode(ToolPresentation.Result)({
      card: "read",
      path: "src/index.ts",
      offset: 10,
      totalLines: 120,
      lang: "ts",
      lines: [
        { number: 10, text: "export const x = 1" },
        { number: 11, text: "export const y = 2" },
      ],
    })
    expect(result).toMatchObject({
      card: "read",
      path: "src/index.ts",
      offset: 10,
      totalLines: 120,
      lang: "ts",
      lines: [
        { number: 10, text: "export const x = 1" },
        { number: 11, text: "export const y = 2" },
      ],
    })
  })

  test("search result discriminates by shape", () => {
    const matches = decode(ToolPresentation.Result)({
      card: "search",
      shape: "matches",
      files: [{ path: "a.ts", matches: [{ lineNumber: 1, line: "TODO" }] }],
      truncated: false,
      total: 1,
    })
    expect(matches).toMatchObject({ card: "search", shape: "matches", total: 1, truncated: false })

    const paths = decode(ToolPresentation.Result)({
      card: "search",
      shape: "paths",
      paths: ["a.ts", "b.ts"],
      truncated: false,
      total: 2,
    })
    expect(paths).toMatchObject({ card: "search", shape: "paths", paths: ["a.ts", "b.ts"] })
  })

  test("web result discriminates by kind", () => {
    const search = decode(ToolPresentation.Result)({
      card: "web",
      kind: "search",
      sources: [{ url: "https://example.com", title: "Example" }],
      truncated: false,
    })
    expect(search).toMatchObject({ card: "web", kind: "search", sources: [{ url: "https://example.com" }] })

    const fetch = decode(ToolPresentation.Result)({
      card: "web",
      kind: "fetch",
      url: "https://example.com",
      statusCode: 200,
      truncated: false,
    })
    expect(fetch).toMatchObject({ card: "web", kind: "fetch", url: "https://example.com", statusCode: 200 })
  })

  test("terminal result with exit code and signal are mutually separable", () => {
    const exited = decode(ToolPresentation.Result)({ card: "terminal", output: "ok", exitCode: 0 })
    expect(exited).toMatchObject({ card: "terminal", output: "ok", exitCode: 0 })
    const killed = decode(ToolPresentation.Result)({ card: "terminal", signal: "SIGTERM" })
    expect(killed).toMatchObject({ card: "terminal", signal: "SIGTERM" })
  })

  test("public identifiers are stable and unique", () => {
    const identifiers = [
      ToolPresentation.Call,
      ToolPresentation.Result,
      ToolPresentation.CallKind,
      ToolPresentation.FileLocation,
      ToolPresentation.FileDiff,
      ToolPresentation.ReadFileLine,
      ToolPresentation.SearchFileMatches,
      ToolPresentation.WebSource,
    ].map((schema) => schema.ast.annotations?.identifier)

    expect(identifiers.every((identifier) => typeof identifier === "string")).toBe(true)
    expect(new Set(identifiers).size).toBe(identifiers.length)
  })

  test("tool session events carry optional presentation payloads", () => {
    const called = decode(SessionEvent.Tool.Called.data)({
      timestamp: 1,
      sessionID: "ses_1",
      assistantMessageID: "msg_1",
      callID: "call_1",
      tool: "bash",
      input: { command: "ls" },
      presentation: { card: "terminal", title: "ls" },
      provider: { executed: false },
    })
    expect(called.presentation).toEqual({ card: "terminal", title: "ls" })

    const success = decode(SessionEvent.Tool.Success.data)({
      timestamp: 2,
      sessionID: "ses_1",
      assistantMessageID: "msg_1",
      callID: "call_1",
      structured: {},
      content: [],
      presentation: { card: "terminal", output: "a.ts", exitCode: 0 },
      provider: { executed: false },
    })
    expect(success.presentation).toEqual({ card: "terminal", output: "a.ts", exitCode: 0 })

    const failed = decode(SessionEvent.Tool.Failed.data)({
      timestamp: 3,
      sessionID: "ses_1",
      assistantMessageID: "msg_1",
      callID: "call_1",
      error: { type: "unknown", message: "boom" },
      presentation: { card: "terminal", signal: "SIGKILL" },
      provider: { executed: false },
    })
    expect(failed.presentation).toEqual({ card: "terminal", signal: "SIGKILL" })

    const omitted = decode(SessionEvent.Tool.Success.data)({
      timestamp: 4,
      sessionID: "ses_1",
      assistantMessageID: "msg_1",
      callID: "call_1",
      structured: {},
      content: [],
      provider: { executed: false },
    })
    expect("presentation" in omitted).toBe(false)
  })
})