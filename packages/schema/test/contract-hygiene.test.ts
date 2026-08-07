import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { Agent } from "../src/agent"
import { FileSystem } from "../src/filesystem"
import { LogEntry } from "../src/log-entry"
import { Model } from "../src/model"
import { Project } from "../src/project"
import { Pty } from "../src/pty"
import { Question } from "../src/question"
import { Session } from "../src/session"
import { SessionEvent } from "../src/session-event"
import { SessionTodo } from "../src/session-todo"
import { TraceContext } from "../src/trace-context"
import { optional, TokenCounts } from "../src/schema"

describe("contract hygiene", () => {
  test("optional properties preserve transformations and omit undefined while encoding", () => {
    const Value = Schema.Struct({ value: optional(Schema.FiniteFromString) })
    expect(Schema.decodeUnknownSync(Value)({ value: "1" })).toEqual({ value: 1 })
    expect(Schema.encodeSync(Value)({ value: 1 })).toEqual({ value: "1" })
    expect(Schema.encodeSync(Value)({ value: undefined })).toEqual({})
  })

  test("todo status and priority preserve arbitrary strings", () => {
    const decode = Schema.decodeUnknownSync(SessionTodo.Info)
    expect(decode({ content: "ship", status: "waiting", priority: "urgent" })).toEqual({
      content: "ship",
      status: "waiting",
      priority: "urgent",
    })
  })

  test("current ID constructors expose create", () => {
    expect(Question.ID.create()).toStartWith("que_")
    expect(Pty.ID.create()).toStartWith("pty_")
  })

  test("reusable public identifiers are stable and unique", () => {
    const identifiers = [
      Agent.Color,
      FileSystem.Submatch,
      Model.Ref,
      Model.Capabilities,
      Model.Cost,
      Model.Api,
      Project.Icon,
      Project.Commands,
      Project.Time,
      Project.Info,
      Pty.Info,
      Session.ListAnchor,
      TokenCounts,
      LogEntry,
      TraceContext,
    ].map((schema) => schema.ast.annotations?.identifier)

    expect(identifiers.every((identifier) => typeof identifier === "string")).toBe(true)
    expect(new Set(identifiers).size).toBe(identifiers.length)
  })

  test("TokenCounts ledger shape is canonical and shared", () => {
    expect(Schema.decodeUnknownSync(Session.Info)({
      id: "ses_1",
      projectID: "proj_1",
      cost: 1,
      tokens: { input: 10, output: 5, reasoning: 1, cache: { read: 2, write: 3 } },
      time: { created: 0, updated: 0 },
      title: "t",
      location: { directory: "/tmp" },
    }).tokens).toEqual({ input: 10, output: 5, reasoning: 1, cache: { read: 2, write: 3 } })

    expect(Schema.encodeSync(TokenCounts)({
      input: 1,
      output: 2,
      reasoning: 0,
      cache: { read: 0, write: 0 },
    })).toEqual({ input: 1, output: 2, reasoning: 0, cache: { read: 0, write: 0 } })
  })

  test("LogEntry is a canonical observability contract with full required field set", () => {
    const encoded = Schema.encodeSync(LogEntry)({
      timestamp: 1,
      level: "INFO",
      service: "opencode-x",
      package: "llm",
      module: "provider",
      function: "call",
      traceId: "t",
      spanId: "s",
      sessionId: "ses_1",
      status: "success",
    })
    expect(encoded).toEqual({
      timestamp: 1,
      level: "INFO",
      service: "opencode-x",
      package: "llm",
      module: "provider",
      function: "call",
      traceId: "t",
      spanId: "s",
      sessionId: "ses_1",
      status: "success",
    })
    expect(Schema.decodeUnknownSync(LogEntry)({ ...encoded, error: "timeout" }).error).toBe("timeout")
  })

  test("TraceContext carries sampling decision and span linkage", () => {
    const ctx = Schema.decodeUnknownSync(TraceContext)({
      traceId: "t1",
      spanId: "s1",
      parentSpanId: "p1",
      sampled: false,
      name: "tool.call",
      kind: "internal",
    })
    expect(ctx.parentSpanId).toBe("p1")
    expect(ctx.sampled).toBe(false)
    expect(Schema.decodeUnknownSync(TraceContext)({
      traceId: "t1",
      spanId: "s1",
      sampled: true,
      name: "root",
      kind: "server",
    }).parentSpanId).toBeUndefined()
  })

  test("current source avoids Any and mutable contract wrappers", async () => {
    const files = [...new Bun.Glob("*.ts").scanSync(new URL("../src", import.meta.url).pathname)].filter(
      (file) => !file.endsWith("-v1.ts"),
    )
    const source = await Promise.all(
      files.map((file) => Bun.file(new URL(`../src/${file}`, import.meta.url)).text()),
    ).then((values) => values.join("\n"))

    expect(source).not.toContain("Schema.Any")
    expect(source).not.toContain("Schema.mutable")
  })
})
