import { RGBA } from "@opentui/core"
import { useTheme } from "../context/theme"
import type { IconName } from "../util/icon-pixel-data"

// ─── Unicode icon map ───────────────────────────────────
//
// Uses common Unicode glyphs (no Nerd Font dependency).
// Status/markers follow kimi-code conventions (● ✓ ✗ ❯ △),
// tool icons follow upstream opencode (⚙ $ ✱ ◈ ← →).

const ICON_CHARS: Record<IconName, string> = {
  // Status — kimi-code style (● ✓ ✗)
  idle: "○",
  busy: "●",
  retry: "↻",
  error: "✗",
  success: "✓",

  // Tools — upstream opencode conventions (⚙ $ ✱ % ◈ ← →)
  bash: "$",
  glob: "✱",
  read: "▤",
  grep: "✱",
  webfetch: "↯",
  websearch: "◈",

  write: "✎",
  edit: "←",
  task: "⚑",
  execute: "⚙",
  apply_patch: "≡",
  todowrite: "☑",

  question: "?",
  skill: "✦",
  generic: "●",

  // Labels — kimi-code markers
  agent: "◆",
  model: "◎",
  thinking: "◇",
  branch: "⎇",
  warn: "△",
  dot: "●",

  // Navigation — kimi-code SELECT_POINTER
  chevron_down: "▼",
  chevron_right: "❯",
  arrow_up: "↑",
  arrow_down: "↓",
  arrow_left: "←",
  arrow_right: "→",
}

export function PixelIcon(props: {
  icon: IconName
  fg?: RGBA
  bg?: RGBA
}) {
  const { theme } = useTheme()
  const char = () => ICON_CHARS[props.icon] ?? "●"

  return (
    <text
      fg={props.fg ?? theme.textMuted}
      bg={props.bg ?? undefined}
    >
      {char()}
    </text>
  )
}
