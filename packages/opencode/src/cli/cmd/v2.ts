import { Effect, Layer } from "effect"
import { promises as fs } from "node:fs"
import path from "node:path"
import { createHash } from "node:crypto"
import os from "node:os"
import { LLMClient, ToolDefinition } from "@opencode-ai/llm"
import { deepseek } from "@opencode-ai/llm/providers/openai-compatible"
import { RequestExecutor, WebSocketExecutor } from "@opencode-ai/llm/route"
import { effectCmd, fail } from "../effect-cmd"
import { Orchestrator, type OrchestratorDeps } from "@opencode-ai/core/v2/execution/orchestrator"
import { Provider } from "@opencode-ai/core/v2/execution/provider"
import { Projection } from "@opencode-ai/core/v2/context/projection"
import type { SchedulableTool } from "@opencode-ai/core/v2/tools/scheduler"
import { FsTools } from "@opencode-ai/core/v2/tools/fs-tools"
import { RunTools } from "@opencode-ai/core/v2/tools/run-tools"
import { Verify } from "@opencode-ai/core/v2/verify/verifier"
import { Trigger } from "@opencode-ai/core/v2/verify/trigger"
import { Memory } from "@opencode-ai/core/v2/memory/store"
import { Sediment } from "@opencode-ai/core/v2/memory/sediment"

const DEFAULT_MODEL = "deepseek-chat"

interface V2Args {
  prompt: string
  provider: string
  model: string
  apiKeyEnv: string
  dir: string
  maxTurns: number
  memDir: string
  json: boolean
  verbose: boolean
}

export const V2Command = effectCmd({
  command: "v2 <prompt>",
  describe: "run a task through the V2 agent architecture (projection → conflict-graph tools → durable memory)",
  builder: (yargs) =>
    yargs
      .positional("prompt", { describe: "the task prompt", type: "string" })
      .option("provider", { describe: "provider id (deepseek)", type: "string", default: "deepseek" })
      .option("model", { describe: "model id", type: "string", default: DEFAULT_MODEL })
      .option("api-key-env", { describe: "env var holding the API key", type: "string" })
      .option("dir", { describe: "workspace directory", type: "string", default: process.cwd() })
      .option("max-turns", { describe: "maximum provider turns", type: "number", default: 20 })
      .option("mem-dir", { describe: "V2 memory directory (default: ~/.local/share/opencode/v2/<dir hash>)", type: "string" })
      .option("json", { describe: "emit machine-readable JSON", type: "boolean", default: false })
      .option("verbose", { describe: "print per-turn detail", type: "boolean", default: false }),
  instance: false,
  handler: Effect.fn("Cli.v2")(function* (args) {
    const prompt = args.prompt.trim()
    if (!prompt) return yield* fail("v2: empty prompt")

    const workspace = path.resolve(args.dir)
    try {
      yield* Effect.promise(() => fs.access(workspace))
    } catch {
      return yield* fail(`v2: workspace directory not found: ${workspace}`)
    }

    const envVar = args.apiKeyEnv ?? `${args.provider.toUpperCase().replace(/-/g, "_")}_API_KEY`
    const apiKey = process.env[envVar]
    if (!apiKey) return yield* fail(`v2: missing API key; set ${envVar} (or pass --api-key-env)`)

    const model = deepseek.configure({ apiKey }).model(args.model)

    const memDir =
      args.memDir ??
      path.join(
        os.homedir(),
        ".local",
        "share",
        "opencode",
        "v2",
        createHash("sha1").update(workspace).digest("hex").slice(0, 12),
      )
    const mem = yield* Effect.promise(() => Memory.openMemory(memDir))
    const confirmed = [...(yield* Effect.promise(() => Memory.replayWire(mem))).values()].filter(
      (e) => e.status === "confirmed",
    )

    const usageLog: Array<Provider.Usage> = []
    const sedimented: string[] = []

    const defs = {
      read: new ToolDefinition({
        name: "read",
        description: "Read a file inside the workspace. Pass a workspace-relative path like src/a.ts.",
        inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
      }),
      write: new ToolDefinition({
        name: "write",
        description: "Overwrite a file inside the workspace. Pass a workspace-relative path and the full new content.",
        inputSchema: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] },
      }),
      search: new ToolDefinition({
        name: "search",
        description: "Search file contents for keywords; returns file:line matches.",
        inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
      }),
      run: new ToolDefinition({
        name: "run",
        description: "Run a shell command in the workspace root (e.g. 'bun test'). Returns exit code and output.",
        inputSchema: { type: "object", properties: { command: { type: "string" } }, required: ["command"] },
      }),
    }
    const toolList = [
      { name: "read", definition: defs.read },
      { name: "write", definition: defs.write },
      { name: "search", definition: defs.search },
      { name: "run", definition: defs.run },
    ]
    const schedulable: ReadonlyArray<SchedulableTool> = [
      { name: "read", access: [{ kind: "file", op: "read", path: workspace }] },
      { name: "write", access: [{ kind: "file", op: "write", path: workspace }] },
      { name: "search", access: [{ kind: "file", op: "read", path: workspace, recursive: true }] },
      { name: "run", access: [{ kind: "global" }] },
    ]

    // Call-level access: derive the actual target path from tool args so the
    // conflict graph can run independent files in parallel (M4).
    const accessForCall = (call: { readonly name: string; readonly input: unknown }) => {
      const input = call.input as { path?: unknown }
      const target = typeof input?.path === "string" ? path.resolve(workspace, input.path) : null
      if (call.name === "write" && target) return [{ kind: "file" as const, op: "write" as const, path: target }]
      if (call.name === "read" && target) return [{ kind: "file" as const, op: "read" as const, path: target }]
      return [{ kind: "global" as const }]
    }

    const settle = (call: { readonly id: string; readonly name: string; readonly input: unknown }) =>
      Effect.gen(function* () {
        const input = call.input as { path?: string; content?: string; query?: string; command?: string }
        if (call.name === "read") return yield* FsTools.read(workspace, input.path ?? "")
        if (call.name === "write") return yield* FsTools.write(workspace, input.path ?? "", input.content ?? "")
        if (call.name === "search") return yield* FsTools.search(workspace, input.query ?? "")
        if (call.name === "run") {
          const out = yield* RunTools.run(workspace, input.command ?? "", 30_000)
          const failures = Verify.parseBunTestOutput(out)
          if (failures.length > 0) {
            yield* Effect.promise(() =>
              Sediment.recordPending(mem, {
                kind: "tool.failed",
                tool: "bun test",
                error: failures[0].message.slice(0, 120),
                category: "Assertion",
                sessionID: "cli-v2",
                at: Date.now(),
              }),
            ).pipe(
              Effect.map((entry) => {
                if (entry) sedimented.push(entry.id)
              }),
            )
            return `${out}\n\n[parsed] ${failures.length} failing test(s): ${failures.map((f) => f.message).join("; ")}`
          }
          return out
        }
        return "unknown tool"
      })

    const deps: OrchestratorDeps = {
      runProviderTurn: (projection, prompt, toolHistory) =>
        Provider.streamTurn({
          llm: { stream: LLMClient.stream },
          request: Provider.buildRequest({ projection, model, tools: toolList, prompt, toolHistory }),
          onUsage: (u) => {
            usageLog.push(u)
          },
        }),
      autoVerify: (paths) =>
        Effect.gen(function* () {
          const verifiers = Trigger.matchingVerifiers(Verify.DEFAULT_VERIFIERS, paths)
          if (verifiers.length === 0) return []
          const reports = yield* Trigger.runVerifiers(workspace, verifiers)
          return Trigger.renderReports(reports)
        }),
    }

    const requestExecutorLayer = RequestExecutor.fetchLayer
    const llmDeps = Layer.mergeAll(requestExecutorLayer, WebSocketExecutor.layer)
    const llmClientLayer = LLMClient.layer.pipe(Layer.provide(llmDeps))

    const result = yield* Orchestrator.runLoop(
      deps,
      {
        prompt,
        source: "user",
        system: [Projection.piece.system("You are a capable coding agent working in a local workspace.")],
        world: [Projection.piece.world(`workspace root is ${workspace}`, workspace)],
        instructions: [Projection.piece.instruction("Use workspace-relative paths. Run tests to verify changes.")],
        memory: confirmed.map((e) => Projection.piece.memory(e.content, e.id)),
        history: [],
        live: [],
        tools: schedulable,
        accessForCall,
        settle,
      },
      args.maxTurns,
    )
      .pipe(
        Effect.provide(Layer.mergeAll(llmDeps, llmClientLayer)),
        Effect.catch((e) => fail(`v2: task failed: ${String(e)}`)),
      )

    const finalTurn = result.turns[result.turns.length - 1]
    const totalInput = usageLog.reduce((acc, u) => acc + (u.input ?? 0), 0)
    const totalOutput = usageLog.reduce((acc, u) => acc + (u.output ?? 0), 0)

    if (args.json) {
      yield* Effect.sync(() =>
        console.log(
          JSON.stringify({
            turns: result.turns.map((t) => ({
              stopReason: t.stopReason,
              tools: t.toolCalls.map((c) => c.name),
              text: t.text,
            })),
            totalInputTokens: totalInput,
            totalOutputTokens: totalOutput,
            finalText: finalTurn?.text ?? "",
            memoryReused: confirmed.length,
            sedimented,
          }),
        ),
      )
      return
    }

    yield* Effect.sync(() => {
      console.log(`\n=== V2 task: ${args.maxTurns > 0 ? result.turns.length : 0} turns ===`)
      if (args.verbose) {
        for (const [i, t] of result.turns.entries()) {
          const tools = t.toolCalls.map((c) => c.name).join(",") || "none"
          console.log(`  turn ${i + 1}: stopReason=${t.stopReason} tools=${tools}`)
        }
      }
      console.log(`tokens: ${totalInput} in / ${totalOutput} out`)
      console.log(`memory: ${confirmed.length} confirmed lesson(s) reused`)
      if (sedimented.length > 0) console.log(`sedimented ${sedimented.length} pending lesson(s) from failures`)
      console.log("\n" + (finalTurn?.text ?? "(no final text)"))
    })
  }),
})

export default V2Command
