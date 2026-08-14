import { Effect, Layer, Schema } from "effect"
import path from "node:path"
import { createHash } from "node:crypto"
import os from "node:os"
import { LLMClient } from "@opencode-ai/llm"
import { deepseek } from "@opencode-ai/llm/providers/openai-compatible"
import { RequestExecutor, WebSocketExecutor } from "@opencode-ai/llm/route"
import { effectCmd, fail, CliError } from "../effect-cmd"
import { Database } from "@opencode-ai/core/database/database"
import { Global } from "@opencode-ai/core/global"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { llmClient } from "@opencode-ai/core/effect/app-node-platform"
import { Event } from "@opencode-ai/core/event"
import { Project } from "@opencode-ai/core/project"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { SessionStore } from "@opencode-ai/core/session/store"
import { Session } from "@opencode-ai/core/session"
import { SessionExecution } from "@opencode-ai/core/session/execution"
import * as SessionExecutionLocal from "@opencode-ai/core/session/execution/local"
import { SessionRunnerModel } from "@opencode-ai/core/session/runner/model"
import { buildLocationServiceMap, LocationServiceMap } from "@opencode-ai/core/location-services"
import { Snapshot } from "@opencode-ai/core/snapshot"
import { Config } from "@opencode-ai/core/config"
import { ConfigCompaction } from "@opencode-ai/core/config/compaction"
import { SkillGuidance } from "@opencode-ai/core/skill/guidance"
import { ReferenceGuidance } from "@opencode-ai/core/reference/guidance"
import { Permission } from "@opencode-ai/core/permission"
import { Prompt } from "@opencode-ai/core/session/prompt"
import { SystemContext } from "@opencode-ai/core/system-context"
import { AppProcess } from "@opencode-ai/core/process"
import { Memory } from "@opencode-ai/core/memory/store"

const DEFAULT_MODEL = "deepseek-chat"

interface V2Args {
  prompt: string
  provider: string
  model: string
  apiKeyEnv: string
  dir: string
  json: boolean
  verbose: boolean
}

export const V2Command = effectCmd({
  command: "v2 <prompt>",
  describe: "run a task through the V2 agent architecture on a durable session (projection → conflict-graph tools → auto-verify → durable memory)",
  builder: (yargs) =>
    yargs
      .positional("prompt", { describe: "the task prompt (also the session goal)", type: "string" })
      .option("provider", { describe: "provider id (deepseek)", type: "string", default: "deepseek" })
      .option("model", { describe: "model id", type: "string", default: DEFAULT_MODEL })
      .option("api-key-env", { describe: "env var holding the API key", type: "string" })
      .option("dir", { describe: "workspace directory", type: "string", default: process.cwd() })
      .option("json", { describe: "emit machine-readable JSON", type: "boolean", default: false })
      .option("verbose", { describe: "print per-message detail", type: "boolean", default: false }),
  instance: false,
  handler: Effect.fn("Cli.v2")(function* (args) {
    const prompt = args.prompt.trim()
    if (!prompt) return yield* fail("v2: empty prompt")

    const workspace = path.resolve(args.dir)
    try {
      yield* Effect.promise(() => import("node:fs/promises").then((fs) => fs.access(workspace)))
    } catch {
      return yield* fail(`v2: workspace directory not found: ${workspace}`)
    }

    const envVar = args.apiKeyEnv ?? `${args.provider.toUpperCase().replace(/-/g, "_")}_API_KEY`
    const apiKey = process.env[envVar]
    if (!apiKey) return yield* fail(`v2: missing API key; set ${envVar} (or pass --api-key-env)`)

    const model = deepseek.configure({ apiKey }).model(args.model)

    const database = yield* Database.Service
    // Headless mode: no interactive approval surface, so every tool is allowed
    // (the CLI v2 task owns its workspace).
    const yoloPermission = Layer.succeed(
      Permission.Service,
      Permission.Service.of({
        assert: () => Effect.void,
        ask: () => Effect.succeed({ id: Permission.ID.make("permission_mock"), effect: "allow" }),
        reply: () => Effect.void,
        get: () => Effect.succeed(undefined),
        forSession: () => Effect.succeed([]),
        list: () => Effect.succeed([]),
      }),
    )
    const config = Layer.succeed(
      Config.Service,
      Config.Service.of({
        entries: () =>
          Effect.succeed([
            new Config.Document({
              type: "document",
              info: new Config.Info({
                compaction: new ConfigCompaction.Info({
                  buffer: 3_000,
                  keep: new ConfigCompaction.Keep({ tokens: 1_000 }),
                }),
              }),
            }),
          ]),
      }),
    )
    const emptyGuidance = Layer.mock(SkillGuidance.Service, { load: () => Effect.succeed(SystemContext.empty) })
    const emptyReference = Layer.mock(ReferenceGuidance.Service, { load: () => Effect.succeed(SystemContext.empty) })

    const locationServiceMapV2 = buildLocationServiceMap([
      [SessionRunnerModel.node, SessionRunnerModel.layerWith(() => Effect.succeed(model))],
      [Permission.node, yoloPermission],
      [Config.node, config],
      [Snapshot.node, Snapshot.noopLayer],
      [SkillGuidance.node, emptyGuidance],
      [ReferenceGuidance.node, emptyReference],
    ])

    const requestExecutorLayer = RequestExecutor.fetchLayer
    const llmDeps = Layer.mergeAll(requestExecutorLayer, WebSocketExecutor.layer)
    const llmClientLayer = LLMClient.layer.pipe(Layer.provide(llmDeps))

    const v2Layer = AppNodeBuilder.build(
      LayerNode.group([
        Event.node,
        SessionProjector.node,
        SessionStore.node,
        Session.node,
        AppProcess.node,
        SessionExecutionLocal.node,
      ]),
      [
        [Database.node, Layer.succeed(Database.Service, database)],
        [Global.node, Global.layerWith({})],
        [LocationServiceMap.node, locationServiceMapV2],
        [SessionExecution.node, SessionExecutionLocal.node],
        [llmClient, llmClientLayer],
      ],
    )

    return yield* Effect.gen(function* () {
      const session = yield* Session.Service
      const execution = yield* SessionExecution.Service

      const info = yield* session.create({
        location: { directory: AbsolutePath.make(workspace) },
        title: prompt.length > 60 ? `${prompt.slice(0, 57)}...` : prompt,
      })
      // M8 goal mode: the prompt is the goal; the runner keeps working after
      // write-then-stop turns until verification settles it.
      yield* session.update({ sessionID: info.id, metadata: { goal: prompt } })
      yield* session.prompt({ sessionID: info.id, prompt: Prompt.make({ text: prompt }), resume: false })
      if (args.verbose)
        console.log(`v2: session ${info.id} — ${info.title}`)

      // resume blocks until the drain completes (join/await active execution).
      yield* execution.resume(info.id).pipe(
        Effect.catch((error) => fail(`v2: task failed: ${String(error)}`)),
      )

      const sessionID = info.id
      const context = yield* session.context(sessionID)
      const finalText = [...context]
        .reverse()
        .find((message) => message.type === "assistant")
        ?.content
        ?.filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("") ?? "(no final text)"
      const final = yield* session.get(sessionID)

      const memDir = path.join(
        os.homedir(),
        ".local",
        "share",
        "opencode",
        "v2",
        createHash("sha1").update(workspace).digest("hex").slice(0, 12),
      )
      const confirmed = [
        ...(yield* Effect.promise(() =>
          Memory.openMemory(memDir).then((store) => Memory.replayWire(store)),
        )).values(),
      ].filter((e) => e.status === "confirmed").length

      if (args.json) {
        yield* Effect.sync(() =>
          console.log(
            JSON.stringify({
              sessionID,
              messages: context.length,
              finalText,
              tokens: {
                input: final.tokens.input,
                output: final.tokens.output,
                reasoning: final.tokens.reasoning,
              },
              cost: final.cost,
              lessonsReused: confirmed,
            }),
          ),
        )
        return
      }

      yield* Effect.sync(() => {
        console.log(`\n=== V2 task complete (session ${sessionID}) ===`)
        console.log(`messages: ${context.length} · tokens: ${final.tokens.input} in / ${final.tokens.output} out`)
        console.log(`memory: ${confirmed} confirmed lesson(s) in workspace library`)
        console.log(`\n${finalText}`)
      })
    }).pipe(
      Effect.provide(v2Layer),
      Effect.mapError((error) => (error instanceof CliError ? error : new CliError({ message: String(error) }))),
    )
  }),
})

export default V2Command
