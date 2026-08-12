import { createContext, useContext } from "solid-js"
import type { Provider } from "@opencode-ai/sdk/v2"
import type { ThinkingMode } from "../../context/thinking"
import { useData } from "../../context/data"
import type { useTuiConfig } from "../../config"

export interface SessionContext {
  width: number
  sessionID: string
  conceal: () => boolean
  thinkingMode: () => ThinkingMode
  showThinking: () => boolean
  showTimestamps: () => boolean
  showDetails: () => boolean
  showGenericToolOutput: () => boolean
  diffWrapMode: () => "word" | "none"
  providers: () => ReadonlyMap<string, Provider>
  sync: ReturnType<typeof useData>
  tui: ReturnType<typeof useTuiConfig>
}

export const context = createContext<SessionContext>()

export function use() {
  const ctx = useContext(context)
  if (!ctx) throw new Error("useContext must be used within a Session component")
  return ctx
}
