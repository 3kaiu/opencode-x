export * as SubagentAgents from "./agents"

import { Effect } from "effect"
import { Agent } from "@opencode-ai/schema/agent"
import { AgentV2 } from "../agent"
import type { DeepMutable } from "../schema"

// Built-in subagent trio (C13): coder, explore, plan. Each is mode "subagent"
// so it never becomes the session default, and carries a purpose-tuned system
// prompt plus a read-only or write-scoped permission profile.
const define = (id: string, fn: (agent: DeepMutable<Agent.Info>) => void): Agent.Info => {
  const agent = Agent.Info.empty(Agent.ID.make(id)) as DeepMutable<Agent.Info>
  fn(agent)
  return agent as Agent.Info
}

export const coder: Agent.Info = define("coder", (agent) => {
  agent.mode = "subagent"
  agent.color = "primary"
  agent.description = "Write and modify code, fix bugs, and run tests"
  agent.system = [
    "You are the coder subagent. Implement the task with focused, minimal changes.",
    "Read the relevant files first, then edit in place. Run the project's tests and typecheck after changing code.",
    "Report what you changed and the verification results.",
  ].join("\n")
  agent.permissions = [{ action: "*", resource: "*", effect: "ask" }]
})

export const explore: Agent.Info = define("explore", (agent) => {
  agent.mode = "subagent"
  agent.color = "info"
  agent.description = "Read-only codebase exploration and research"
  agent.system = [
    "You are the explore subagent. Investigate the codebase and answer questions with evidence.",
    "You are read-only: never modify files or execute commands. Use read, grep, and glob to gather facts.",
    "Cite file paths for every claim you make.",
  ].join("\n")
  agent.permissions = readOnlyPermissions()
})

export const plan: Agent.Info = define("plan", (agent) => {
  agent.mode = "subagent"
  agent.color = "warning"
  agent.description = "Research and produce an implementation plan without changing code"
  agent.system = [
    "You are the plan subagent. Research the problem and produce a concrete implementation plan.",
    "You are read-only: never modify files or execute commands.",
    "Structure your plan as numbered steps with file paths, verification steps, and risks.",
  ].join("\n")
  agent.permissions = readOnlyPermissions()
})

export const all: ReadonlyArray<Agent.Info> = [coder, explore, plan]

function readOnlyPermissions() {
  return [
    { action: "bash", resource: "*", effect: "deny" as const },
    { action: "edit", resource: "*", effect: "deny" as const },
    { action: "write", resource: "*", effect: "deny" as const },
    { action: "apply_patch", resource: "*", effect: "deny" as const },
    { action: "read", resource: "*", effect: "allow" as const },
    { action: "grep", resource: "*", effect: "allow" as const },
    { action: "glob", resource: "*", effect: "allow" as const },
  ]
}

// Merge the built-in subagents into the agent registry, preserving any
// user-defined agent with the same ID. Safe to call once at composition root.
export const register = Effect.fn("SubagentAgents.register")(function* () {
  const agents = yield* AgentV2.Service
  yield* agents.transform((editor) => {
    for (const builtin of all) {
      if (editor.get(builtin.id)) continue
      editor.update(builtin.id, (agent) => Object.assign(agent, builtin))
    }
  })
  return undefined
})
