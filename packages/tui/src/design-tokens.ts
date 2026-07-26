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

/** Left padding for boxes with a left border, so content aligns with MESSAGE_INDENT (border occupies one column) */
export const MESSAGE_INDENT_BORDERED = MESSAGE_INDENT - 1

const roundedChars = {
  ...EmptyBorder,
  topLeft: "╭",
  topRight: "╮",
  bottomLeft: "╰",
  bottomRight: "╯",
  horizontal: "─",
  vertical: "│",
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
