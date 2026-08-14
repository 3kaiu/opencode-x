import type { AgentInfo } from "@opencode-ai/sdk/v2/types"
import type { Hooks } from "./registration.js"

export interface AgentDraft {
  list(): readonly AgentInfo[]
  get(id: string): AgentInfo | undefined
  default(id: string | undefined): void
  update(id: string, update: (agent: AgentInfo) => void): void
  remove(id: string): void
}

export type AgentHooks = Hooks<{
  transform: AgentDraft
}>
