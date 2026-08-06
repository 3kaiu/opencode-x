// V2 session command runner — command template rendering + V2 admission.
//
// Migration of the legacy `SessionPrompt.command` rendering pipeline onto the
// V2 stack: template expansion stays app-side (commands are application
// definitions), but the final action is either a V2 prompt admission
// (non-subtask) or a SubagentRunner delegation (subtask commands) instead of
// the legacy `SessionPrompt.loop` path.

import { Effect, Option, Schema } from "effect"
import os from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { ConfigMarkdown } from "@/config/markdown"
import { Command } from "@/command"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { SessionV2 } from "@opencode-ai/core/session"
import { SessionSchema } from "@opencode-ai/core/session/schema"
import { Prompt } from "@opencode-ai/core/session/prompt"
import { SubagentRunner } from "@opencode-ai/core/subagent/runner"
import { SessionExecution } from "@opencode-ai/core/session/execution"
import type { SessionCommandInput } from "@opencode-ai/server/session-command"

const bashRegex = /!`([^`]+)`/g
const argsRegex = /(?:\[Image\s+\d+\]|"[^"]*"|'[^']*'|[^\s"']+)/gi
const placeholderRegex = /\$(\d+)/g
const quoteTrimRegex = /^["']|["']$/g

/**
 * Renders a command definition's template with the given arguments and
 * expands file/agent references, mirroring the legacy SessionPrompt.command
 * pipeline (kept behavior-compatible).
 */
export const renderCommandTemplate = Effect.fn("CommandV2.render")(function* (input: {
  readonly cmd: Command.Info
  readonly arguments: string
  readonly worktree: string
}) {
  const args = (input.arguments.match(argsRegex) ?? []).map((arg) => arg.replace(quoteTrimRegex, ""))
  const templateCommand = yield* Effect.promise(async () => input.cmd.template)

  const placeholders = templateCommand.match(placeholderRegex) ?? []
  let last = 0
  for (const item of placeholders) {
    const value = Number(item.slice(1))
    if (value > last) last = value
  }
  const withArgs = templateCommand.replaceAll(placeholderRegex, (_, index) => {
    const position = Number(index)
    const argIndex = position - 1
    if (argIndex >= args.length) return ""
    if (position === last) return args.slice(argIndex).join(" ")
    return args[argIndex]
  })
  const usesArgumentsPlaceholder = templateCommand.includes("$ARGUMENTS")
  let template = withArgs.replaceAll("$ARGUMENTS", input.arguments)
  if (placeholders.length === 0 && !usesArgumentsPlaceholder && input.arguments.trim()) {
    template = template + "\n\n" + input.arguments
  }

  const shellMatches = ConfigMarkdown.shell(template)
  if (shellMatches.length > 0) {
    const results = yield* Effect.promise(() =>
      Promise.all(
        shellMatches.map(async ([, cmd]) => (await Bun.$`${cmd}`.nothrow().text()).trim()),
      ),
    )
    let index = 0
    template = template.replace(bashRegex, () => results[index++])
  }
  return template.trim()
})

/** Expands @file/agent references inside a rendered template (legacy parity). */
export const expandTemplateParts = Effect.fn("CommandV2.expand")(function* (input: {
  readonly template: string
  readonly worktree: string
}) {
  const fs = yield* FSUtil.Service
  const parts: Array<{ type: "text" | "file" | "agent"; text?: string; url?: string; name?: string; mime?: string }> = [
    { type: "text", text: input.template },
  ]
  const files = ConfigMarkdown.files(input.template)
  const seen = new Set<string>()
  yield* Effect.forEach(
    files,
    Effect.fnUntraced(function* (match) {
      const name = match[1]
      if (!name || seen.has(name)) return
      seen.add(name)
      const filepath = name.startsWith("~/") ? path.join(os.homedir(), name.slice(2)) : path.resolve(input.worktree, name)
      const info = yield* fs.stat(filepath).pipe(Effect.option)
      if (Option.isNone(info)) {
        // @agent reference: keep the name; the delegation hint surfaces it to the model.
        parts.push({ type: "agent", name })
        return
      }
      parts.push({
        type: "file",
        url: pathToFileURL(filepath).href,
        name,
        mime: info.value.type === "Directory" ? "application/x-directory" : "text/plain",
      })
    }),
    { concurrency: "unbounded", discard: true },
  )
  return parts
})

/**
 * Runs a session command on the V2 stack. Non-subtask commands admit a V2
 * prompt (waking the drain); subtask commands delegate directly through the
 * SubagentRunner with the rendered template as the task.
 */
export const runCommandV2 = Effect.fn("CommandV2.run")(function* (input: SessionCommandInput & {
  readonly worktree: string
}) {
  const commands = yield* Command.Service
  const cmd = yield* commands.get(input.command)
  if (!cmd) {
    const available = (yield* commands.list()).map((c) => c.name)
    const hint = available.length ? ` Available commands: ${available.join(", ")}` : ""
    return yield* new CommandNotFoundError({ message: `Command not found: "${input.command}".${hint}` })
  }

  const template = yield* renderCommandTemplate({ cmd, arguments: input.arguments, worktree: input.worktree })
  const parts = yield* expandTemplateParts({ template, worktree: input.worktree })
  const text = parts.filter((p) => p.type === "text").map((p) => p.text ?? "").join("\n")

  const isSubtask = cmd.subtask === true
  const files = parts.filter((p): p is { type: "file"; url: string; name?: string; mime: string } => p.type === "file")
  const refs = parts.filter((p): p is { type: "agent"; name: string } => p.type === "agent")

  if (isSubtask) {
    const runner = yield* SubagentRunner.Service
    const taskAgent = cmd.agent ?? input.agent
    if (!taskAgent) return yield* new CommandNotFoundError({ message: `Subtask command "${input.command}" has no agent` })
    yield* runner.run({
      agentID: taskAgent as never,
      task: text,
      context: undefined,
      parentSessionID: input.sessionID,
    })
    return
  }

  const session = yield* SessionV2.Service
  const execution = yield* SessionExecution.Service
  yield* session.prompt({
    sessionID: input.sessionID,
    prompt: Prompt.make({
      text,
      ...(files.length > 0 ? { files: files.map((f) => ({ uri: f.url, mime: f.mime, name: f.name })) } : {}),
      ...(refs.length > 0 ? { agents: refs.map((r) => ({ name: r.name })) } : {}),
    }),
    resume: true,
  })
  yield* execution.wake(input.sessionID).pipe(Effect.ignore)
})

export class CommandNotFoundError extends Schema.TaggedErrorClass<CommandNotFoundError>()("CommandNotFoundError", {
  message: Schema.String,
}) {}
