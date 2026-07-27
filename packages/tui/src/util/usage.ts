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
