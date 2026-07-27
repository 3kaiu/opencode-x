import { createMemo, createSignal, Show } from "solid-js"
import type { JSX } from "@opentui/solid"
import type { RGBA } from "@opentui/core"
import { useTheme } from "../../context/theme"
import { useKV } from "../../context/kv"
import type { Theme } from "../../theme"
import { tint } from "../../theme"
import { BRAILLE_FRAMES, GLYPH, RESULT_PREFIX, collapsedHint, expandedHint } from "../../ui/glyphs"
import { registerOpencodeSpinner } from "../register-spinner"

registerOpencodeSpinner()

export type ToolVisualState = "pending" | "running" | "permission" | "complete" | "error" | "denied"

/**
 * Canonical bullet/label colors for every tool state so "done", "running",
 * and "failed" read the same everywhere in the message flow.
 */
export function toolStateColor(theme: Theme, state: ToolVisualState): { dot: RGBA; label: RGBA } {
  switch (state) {
    case "pending":
      return { dot: theme.textMuted, label: theme.textMuted }
    case "running":
      return { dot: theme.primary, label: theme.text }
    case "permission":
      return { dot: theme.warning, label: theme.text }
    case "complete":
      return { dot: theme.success, label: theme.text }
    case "error":
      return { dot: theme.error, label: theme.text }
    case "denied":
      return { dot: theme.error, label: theme.textMuted }
  }
}

/**
 * A logical block: fixed 2-column bullet glyph followed by flowing content.
 * When `spinner` is set the glyph cell animates instead (braille frames).
 */
export function Bullet(props: {
  color: RGBA
  glyph?: string
  spinner?: boolean
  marginTop?: number
  children: JSX.Element
}) {
  const kv = useKV()
  const { theme } = useTheme()
  // Breathing gradient: each braille frame nudges the base color toward the
  // theme accent on a triangle wave, so the spinner "pulses" instead of sitting
  // on one flat hue. Built once per color/accent pair to avoid per-frame churn.
  const gradient = createMemo(() => {
    const base = props.color
    const accent = theme.accent
    return (frameIndex: number, _charIndex: number, totalFrames: number) => {
      const phase = totalFrames > 1 ? frameIndex / (totalFrames - 1) : 0
      const wave = 1 - Math.abs(phase * 2 - 1)
      return tint(base, accent, wave * 0.5)
    }
  })
  return (
    <box flexDirection="row" marginTop={props.marginTop}>
      <box width={2} flexShrink={0}>
        <Show
          when={props.spinner && kv.get("animations_enabled", true)}
          fallback={<text fg={props.color}>{props.spinner ? GLYPH.idleSpinner : (props.glyph ?? GLYPH.bullet)}</text>}
        >
          <spinner frames={BRAILLE_FRAMES} interval={80} color={gradient()} />
        </Show>
      </box>
      <box flexGrow={1} flexShrink={1}>
        {props.children}
      </box>
    </box>
  )
}

/**
 * Hanging-indent result line(s) under a Bullet: `⎿  content`.
 */
export function ResultBlock(props: { color?: RGBA; children: JSX.Element }) {
  const { theme } = useTheme()
  return (
    <box flexDirection="row">
      <box width={RESULT_PREFIX.length} flexShrink={0}>
        <text fg={props.color ?? theme.textMuted}>{GLYPH.result}</text>
      </box>
      <box flexGrow={1} flexShrink={1}>
        {props.children}
      </box>
    </box>
  )
}

/**
 * The one true collapse/expand affordance: `… +N lines (<shortcut> expand)`.
 */
export function CollapsedHint(props: {
  hidden: number
  expanded: boolean
  onToggle: () => void
  shortcut?: string
  color?: RGBA
}) {
  const { theme } = useTheme()
  const [hover, setHover] = createSignal(false)
  return (
    <box
      flexDirection="row"
      onMouseOver={() => setHover(true)}
      onMouseOut={() => setHover(false)}
      onMouseUp={() => props.onToggle()}
    >
      <text fg={hover() ? theme.text : (props.color ?? theme.textMuted)}>
        {props.expanded ? expandedHint(props.shortcut) : collapsedHint(props.hidden, props.shortcut)}
      </text>
    </box>
  )
}
