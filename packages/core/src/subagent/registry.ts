export * as SubagentRegistry from "./registry"

export type SubAgentType = "coder" | "explore" | "plan"

export interface SubAgentDefinition {
  readonly type: SubAgentType
  readonly description: string
  readonly tools: ReadonlyArray<string>
  readonly canSpawn: boolean
  readonly omitProjectInstructions: boolean
}

const coder: SubAgentDefinition = {
  type: "coder",
  description: "General-purpose coding agent",
  tools: ["read", "write", "edit", "bash", "grep", "glob"],
  canSpawn: true,
  omitProjectInstructions: false,
}

const explore: SubAgentDefinition = {
  type: "explore",
  description: "Read-only codebase exploration",
  tools: ["read", "grep", "glob"],
  canSpawn: false,
  omitProjectInstructions: true,
}

const plan: SubAgentDefinition = {
  type: "plan",
  description: "Architecture design and planning",
  tools: ["read", "grep", "glob"],
  canSpawn: false,
  omitProjectInstructions: true,
}

export const BUILTIN_AGENTS: Record<SubAgentType, SubAgentDefinition> = {
  coder,
  explore,
  plan,
}

export const resolve = (type: SubAgentType): SubAgentDefinition | undefined =>
  BUILTIN_AGENTS[type]
