import { describe, expect } from "bun:test"
import { DateTime, Effect, Layer } from "effect"
import { Catalog } from "@opencode-ai/core/catalog"
import { Integration } from "@opencode-ai/core/integration"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { EventV2 } from "@opencode-ai/core/event"
import { Location } from "@opencode-ai/core/location"
import { ModelV2 } from "@opencode-ai/core/model"
import { ModelsDev } from "@opencode-ai/core/models-dev"
import { ModelsDevPlugin } from "@opencode-ai/core/plugin/models-dev"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { ProjectV2 } from "@opencode-ai/core/project"
import { SessionSchema } from "@opencode-ai/core/session/schema"
import { SessionRunnerModel } from "@opencode-ai/core/session/runner/model"
import { location } from "./fixture/location"
import { testEffect } from "./lib/effect"
import { catalogHost, host, integrationHost } from "./plugin/host"

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Expected value")
  return value
}

const locationLayer = Layer.succeed(
  Location.Service,
  Location.Service.of(location({ directory: AbsolutePath.make(import.meta.dir) })),
)
const layer = AppNodeBuilder.build(LayerNode.group([Catalog.node, Integration.node, EventV2.node]), [
  [Location.node, locationLayer],
])
const it = testEffect(layer)

const zenFixture = {
  opencode: {
    id: "opencode",
    name: "OpenCode Zen",
    env: ["OPENCODE_API_KEY"],
    npm: "@ai-sdk/openai-compatible",
    api: "https://opencode.ai/zen/v1",
    models: {
      "deepseek-v4-flash-free": {
        id: "deepseek-v4-flash-free",
        name: "DeepSeek V4 Flash Free",
        release_date: "2026-07-31",
        attachment: false,
        reasoning: true,
        temperature: true,
        tool_call: true,
        reasoning_options: [{ type: "effort", values: ["low", "high", "max"] }],
        limit: { context: 200_000, output: 128_000 },
      },
    },
  },
} satisfies Record<string, ModelsDev.Provider>

describe("V2 model resolution for the built-in zen provider", () => {
  it.effect("resolves opencode/deepseek-v4-flash-free at max effort without any credential", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      yield* ModelsDevPlugin.effect(
        host({
          catalog: catalogHost(catalog),
          integration: integrationHost(yield* Integration.Service),
        }),
      ).pipe(
        Effect.provideService(
          ModelsDev.Service,
          ModelsDev.Service.of({ get: () => Effect.succeed(zenFixture), refresh: () => Effect.void }),
        ),
      )

      const model = yield* catalog.model.get(ProviderV2.ID.opencode, ModelV2.ID.make("deepseek-v4-flash-free"))
      expect(model?.variants.map((variant) => String(variant.id))).toContain("max")

      const session = SessionSchema.Info.make({
        id: SessionSchema.ID.make("ses_test"),
        projectID: ProjectV2.ID.make("test"),
        title: "test",
        model: {
          id: ModelV2.ID.make("deepseek-v4-flash-free"),
          providerID: ProviderV2.ID.opencode,
          variant: ModelV2.VariantID.make("max"),
        },
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        time: { created: DateTime.makeUnsafe(0), updated: DateTime.makeUnsafe(0) },
        location: Location.Ref.make({ directory: AbsolutePath.make("test") }),
      })

      const resolved = yield* SessionRunnerModel.resolve(session, required(model))
      expect(String(resolved.id)).toBe("deepseek-v4-flash-free")
      expect(String(resolved.provider)).toBe("opencode")
    }),
  )
})
