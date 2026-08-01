import { Locale } from "./locale"
import type { Theme } from "../theme"

/**
 * Shared context-window usage warning colors: >80% is urgent, >60% is caution.
 */
export function usageColor(theme: Theme, percent: number | undefined) {
  if (percent === undefined) return theme.textMuted
  if (percent > 80) return theme.error
  if (percent > 60) return theme.warning
  return theme.textMuted
}

/**
 * Shared "tokens (pct) · cache N" usage string for the prompt bar and the
 * subagent footer. Returns undefined when there is no token usage to show.
 */
export function usageContext(
  tokens: {
    readonly input: number
    readonly output: number
    readonly reasoning: number
    readonly cache: { readonly read: number; readonly write: number }
  },
  contextLimit: number | undefined,
) {
  const total = tokens.input + tokens.output + tokens.reasoning + tokens.cache.read + tokens.cache.write
  if (total <= 0) return undefined
  const percent = contextLimit ? Math.round((total / contextLimit) * 100) : undefined
  const context = percent !== undefined ? `${Locale.number(total)} (${percent}%)` : Locale.number(total)
  const cache = tokens.cache.read > 0 ? ` · cache ${Locale.number(tokens.cache.read)}` : ""
  return { context: `${context}${cache}`, percent }
}
