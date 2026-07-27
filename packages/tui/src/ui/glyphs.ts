/**
 * Single source of truth for all UI glyphs. Every character here is intended
 * to render single-width; if a terminal renders U+23FA double-width, flip
 * BULLET to the FALLBACK_BULLET without touching any layout constants.
 */
export const GLYPH = {
  /** Logical block bullet prefixing user text, assistant text, and tool calls */
  bullet: "⏺",
  /** Fallback bullet for terminals that render U+23FA as a double-width emoji */
  bulletFallback: "●",
  /** Hanging-indent prefix for tool results, error details, and summaries */
  result: "⎿",
  /** Thinking/reasoning block prefix, distinct from the tool bullet */
  thinking: "✻",
  /** Failure marker, used only inside result lines and MCP status */
  cross: "✗",
  /** Success marker for status dots outside the message flow */
  check: "✓",
  /** Interpunct separator */
  dot: "·",
  /** Ellipsis used by collapse hints */
  ellipsis: "…",
  /** Non-animated spinner stand-in */
  idleSpinner: "⋯",
  todo: {
    pending: "☐",
    inProgress: "☐",
    completed: "☒",
  },
  /** Server status markers for MCP/LSP (footer, status dialog, mcp dialog) */
  mcp: {
    connected: "●",
    failed: "✗",
    disabled: "○",
    loading: "⋯",
  },
} as const

/** `⎿` plus two spaces — content after a result prefix hangs at 3 columns */
export const RESULT_PREFIX = `${GLYPH.result}  `
export const RESULT_PREFIX_WIDTH = 3

/** Braille frames for running-state bullets and inline spinners */
export const BRAILLE_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]

/** Star pulse frames for the prompt activity line */
export const PULSE_FRAMES = ["✢", "✳", "✶", "✻", "✽", "✻", "✶", "✳"]

export function collapsedHint(hidden: number, shortcut?: string) {
  const suffix = shortcut ? ` (${shortcut} expand)` : ""
  return `${GLYPH.ellipsis} +${hidden} ${hidden === 1 ? "line" : "lines"}${suffix}`
}

export function expandedHint(shortcut?: string) {
  return shortcut ? `${GLYPH.ellipsis} collapse (${shortcut})` : `${GLYPH.ellipsis} collapse`
}
