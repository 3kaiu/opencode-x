import { EmptyBorder } from "./ui/border"

export const space = {
  none: 0,
  xs: 1,
  sm: 2,
  md: 3,
  lg: 4,
  xl: 6,
} as const

/** Unified chrome gutter — all structural content gets this left/right padding */
export const chromeGutter = 1

/** Unified left indent for all message/part content in session view */
export const MESSAGE_INDENT = 3

/** Vertical gap between top-level messages in the session view */
export const MESSAGE_GAP = 2

/** Vertical gap between parts within one message (text, tools, errors) */
export const PART_GAP = 1

const roundedChars = {
  ...EmptyBorder,
  topLeft: "╭",
  topRight: "╮",
  bottomLeft: "╰",
  bottomRight: "╯",
  horizontal: "─",
  vertical: "│",
}

/** ASCII fallback for terminals that render the rounded box chars double-width */
export const roundedBorderFallback = {
  ...EmptyBorder,
  topLeft: "+",
  topRight: "+",
  bottomLeft: "+",
  bottomRight: "+",
  horizontal: "-",
  vertical: "|",
}

export const borderVariant = {
  none: { border: [] as const },
  accent: { border: ["left"] as const, customBorderChars: { ...EmptyBorder, vertical: "┃" } },
  subtle: { border: ["left"] as const, customBorderChars: { ...EmptyBorder, vertical: "│" } },
  panel: { border: ["left", "right"] as const, customBorderChars: { ...EmptyBorder, vertical: "▏" } },
  rounded: {
    border: ["top", "bottom", "left", "right"] as const,
    customBorderChars: roundedChars,
  },
} as const
