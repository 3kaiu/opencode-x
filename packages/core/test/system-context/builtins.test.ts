import { afterAll, beforeAll, describe, expect } from "bun:test"
import { createHash } from "node:crypto"
import path from "node:path"
import { Effect, Layer } from "effect"
import * as TestClock from "effect/testing/TestClock"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Location } from "@opencode-ai/core/location"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Global } from "@opencode-ai/core/global"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SystemContext } from "@opencode-ai/core/system-context"
import { SystemContextBuiltIns } from "@opencode-ai/core/system-context/builtins"
import { SystemContextRegistry } from "@opencode-ai/core/system-context/registry"
import { location } from "../fixture/location"
import { testEffect } from "../lib/effect"

const directory = AbsolutePath.make(FSUtil.resolve("/repo/packages/core"))
const projectDirectory = AbsolutePath.make(FSUtil.resolve("/repo"))
const instructionFile = FSUtil.resolve("/repo/AGENTS.md")
const timestamp = Date.parse("2026-06-03T12:00:00.000Z")
const localDate = (time: number) => new Date(time).toDateString()
const memoryDataDir = "/tmp/opencode-core-system-context-test"
const memoryHash = createHash("sha1").update(String(directory)).digest("hex").slice(0, 12)
const locationLayer = Layer.succeed(
  Location.Service,
  Location.Service.of(
    location(
      { directory },
      { projectDirectory, vcs: { type: "git", store: AbsolutePath.make(FSUtil.resolve("/repo/.git")) } },
    ),
  ),
)
const builtInsNode = LayerNode.group([SystemContextBuiltIns.node, SystemContextRegistry.node])
const it = testEffect(
  AppNodeBuilder.build(builtInsNode, [
    [Location.node, locationLayer],
    [Global.node, Global.layerWith({ config: "/global", data: memoryDataDir })],
  ]),
)
const instructionFS = Layer.effect(
  FSUtil.Service,
  FSUtil.Service.pipe(
    Effect.map((fs) =>
      FSUtil.Service.of({
        ...fs,
        up: () => Effect.succeed([instructionFile]),
        readFileStringSafe: (path) => Effect.succeed(path === instructionFile ? "Be precise." : undefined),
      }),
    ),
  ),
).pipe(Layer.provide(LayerNode.compile(FSUtil.node)))
const itWithInstructions = testEffect(
  AppNodeBuilder.build(builtInsNode, [
    [Location.node, locationLayer],
    [FSUtil.node, instructionFS],
    [Global.node, Global.layerWith({ config: "/global", data: memoryDataDir })],
  ]),
)
const lessonsDataDir = "/tmp/opencode-core-system-context-lessons-test"
const itWithLessons = testEffect(
  AppNodeBuilder.build(builtInsNode, [
    [Location.node, locationLayer],
    [Global.node, Global.layerWith({ config: "/global", data: lessonsDataDir })],
  ]),
)

describe("SystemContextBuiltIns", () => {
  beforeAll(async () => {
    const fs = await import("node:fs/promises")
    await fs.rm(memoryDataDir, { recursive: true, force: true })
  })
  afterAll(async () => {
    const fs = await import("node:fs/promises")
    await fs.rm(memoryDataDir, { recursive: true, force: true })
    await fs.rm(lessonsDataDir, { recursive: true, force: true })
  })

  it.effect("loads location-scoped environment and host-local date context", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(timestamp)
      const context = yield* SystemContextRegistry.Service
      const initialized = yield* SystemContext.initialize(yield* context.load())

      expect(initialized.baseline).toBe(
        [
          "Here is some useful information about the environment you are running in:",
          "<env>",
          `  Working directory: ${directory}`,
          `  Workspace root folder: ${projectDirectory}`,
          "  Is directory a git repo: yes",
          `  Platform: ${process.platform}`,
          "</env>",
          "",
          `Today's date: ${localDate(timestamp)}`,
          "",
          "No previous-session lessons recorded for this workspace yet.",
        ].join("\n"),
      )
    }),
  )

  it.effect("reconciles the date without repeating unchanged environment context", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(timestamp)
      const context = yield* SystemContextRegistry.Service
      const initialized = yield* SystemContext.initialize(yield* context.load())

      yield* TestClock.setTime(timestamp + 24 * 60 * 60 * 1000)
      const refreshed = yield* SystemContext.reconcile(yield* context.load(), initialized.snapshot)

      expect(refreshed).toMatchObject({
        _tag: "Updated",
        text: `Today's date is now: ${localDate(timestamp + 24 * 60 * 60 * 1000)}`,
      })
    }),
  )

  it.effect("does not update again within the same local calendar day", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(timestamp)
      const context = yield* SystemContextRegistry.Service
      const initialized = yield* SystemContext.initialize(yield* context.load())

      yield* TestClock.setTime(timestamp + 60 * 60 * 1000)
      expect(yield* SystemContext.reconcile(yield* context.load(), initialized.snapshot)).toEqual({ _tag: "Unchanged" })
    }),
  )

  itWithLessons.effect("injects confirmed v2 lessons from the workspace memory library", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(timestamp)
      const memDir = path.join(lessonsDataDir, "v2", memoryHash)
      const wire = path.join(memDir, "memories.wire.jsonl")
      yield* Effect.promise(async () => {
        const fs = await import("node:fs/promises")
        await fs.mkdir(memDir, { recursive: true })
        const confirmed = {
          type: "memory.upsert",
          entry: {
            id: "lesson-1",
            category: "lesson",
            title: "Verify after every write",
            content: "Always run typecheck after editing TypeScript files",
            keywords: ["verify", "typecheck"],
            created_at: timestamp,
            updated_at: timestamp,
            status: "confirmed",
          },
        }
        const pending = {
          type: "memory.upsert",
          entry: {
            id: "pending-1",
            category: "lesson",
            title: "Pending lesson",
            content: "This one is still pending and must not be injected",
            keywords: [],
            created_at: timestamp,
            updated_at: timestamp,
            status: "pending",
          },
        }
        await fs.writeFile(wire, `${JSON.stringify(confirmed)}\n${JSON.stringify(pending)}\n`)
      })
      const context = yield* SystemContextRegistry.Service
      const initialized = yield* SystemContext.initialize(yield* context.load())

      expect(initialized.baseline).toContain(
        'Here are some lessons learned from previous sessions in this workspace:\n<lesson id="lesson-1" category="lesson">Always run typecheck after editing TypeScript files</lesson>',
      )
      expect(initialized.baseline).not.toContain("still pending")
    }),
  )

  itWithInstructions.effect("composes ambient instructions after built-in context", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(timestamp)
      const context = yield* SystemContextRegistry.Service

      expect((yield* SystemContext.initialize(yield* context.load())).baseline).toBe(
        [
          "Here is some useful information about the environment you are running in:",
          "<env>",
          `  Working directory: ${directory}`,
          `  Workspace root folder: ${projectDirectory}`,
          "  Is directory a git repo: yes",
          `  Platform: ${process.platform}`,
          "</env>",
          "",
          `Today's date: ${localDate(timestamp)}`,
          "",
          "No previous-session lessons recorded for this workspace yet.",
          "",
          `Instructions from: ${instructionFile}\nBe precise.`,
        ].join("\n"),
      )
    }),
  )
})
