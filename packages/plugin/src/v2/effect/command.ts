import type { CommandInfo } from "@opencode-ai/sdk/v2/types"
import type { Hooks } from "./registration.js"

export interface CommandDraft {
  list(): readonly CommandInfo[]
  get(name: string): CommandInfo | undefined
  update(name: string, update: (command: CommandInfo) => void): void
  remove(name: string): void
}

export type CommandHooks = Hooks<{
  transform: CommandDraft
}>
