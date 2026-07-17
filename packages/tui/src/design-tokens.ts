import { EmptyBorder } from "./ui/border"

export const space = {
  none: 0,
  xs: 1,
  sm: 2,
  md: 3,
  lg: 4,
  xl: 6,
} as const

export const duration = {
  instant: 80,
  fast: 120,
  normal: 160,
  slow: 240,
} as const

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
