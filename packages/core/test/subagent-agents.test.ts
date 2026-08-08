import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { AgentV2 } from "@opencode-ai/core/agent"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { SubagentAgents } from "@opencode-ai/core/subagent/agents"
import { testEffect } from "./lib/effect"

const it = testEffect(AppNodeBuilder.build(AgentV2.node))

describe("SubagentAgents", () => {
  it.effect("defines the coder/explore/plan trio as subagents", () =>
    Effect.gen(function* () {
      expect(SubagentAgents.all.map((agent) => agent.id)).toEqual([
        AgentV2.ID.make("coder"),
        AgentV2.ID.make("explore"),
        AgentV2.ID.make("plan"),
      ])
      for (const agent of SubagentAgents.all) {
        expect(agent.mode).toBe("subagent")
        expect(agent.system).toBeTruthy()
        expect(agent.description).toBeTruthy()
      }
    }),
  )

  it.effect("keeps explore and plan read-only", () =>
    Effect.gen(function* () {
      const denies = (agent: AgentV2.Info) =>
        agent.permissions.filter((rule) => rule.effect === "deny").map((rule) => rule.action)
      const allows = (agent: AgentV2.Info) =>
        agent.permissions.filter((rule) => rule.effect === "allow").map((rule) => rule.action)

      for (const agent of [SubagentAgents.explore, SubagentAgents.plan]) {
        expect(denies(agent)).toEqual(expect.arrayContaining(["bash", "edit", "write", "apply_patch"]))
        expect(allows(agent)).toEqual(expect.arrayContaining(["read", "grep", "glob"]))
      }
      expect(SubagentAgents.coder.permissions.some((rule) => rule.effect === "ask")).toBe(true)
    }),
  )

  it.effect("registers the trio and preserves user-defined agents", () =>
    Effect.gen(function* () {
      const agents = yield* AgentV2.Service
      yield* agents.transform((editor) =>
        editor.update(AgentV2.ID.make("coder"), (info) => {
          info.description = "user custom coder"
        }),
      )
      yield* SubagentAgents.register()

      const coder = yield* agents.get(AgentV2.ID.make("coder"))
      expect(coder?.description).toBe("user custom coder")
      expect((yield* agents.all()).map((info) => info.id)).toEqual(
        expect.arrayContaining([AgentV2.ID.make("coder"), AgentV2.ID.make("explore"), AgentV2.ID.make("plan")]),
      )
    }),
  )
})
