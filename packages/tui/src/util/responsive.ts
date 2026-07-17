import { createMemo, type Accessor } from "solid-js"
import { useTerminalDimensions } from "@opentui/solid"

export type Breakpoint = "compact" | "normal" | "wide"

const thresholds = {
  compact: 0,
  normal: 100,
  wide: 140,
} as const

export function useResponsive(): Accessor<Breakpoint> {
  const dimensions = useTerminalDimensions()
  return createMemo(() => {
    const w = dimensions().width
    if (w >= thresholds.wide) return "wide"
    if (w >= thresholds.normal) return "normal"
    return "compact"
  })
}

export function useContentWidth(padding = 4): Accessor<number> {
  const dimensions = useTerminalDimensions()
  return createMemo(() => dimensions().width - padding)
}
