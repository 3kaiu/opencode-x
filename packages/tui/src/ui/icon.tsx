import { createMemo, Show, type Accessor, createSignal, onCleanup, createEffect, type JSX } from "solid-js"
import { createTimeline, engine, RGBA } from "@opentui/core"
import { useTheme } from "../context/theme"
import { useKV } from "../context/kv"
import { PixelIcon } from "../component/icon-renderable"
import type { IconName } from "../util/icon-pixel-data"
import type { Theme } from "../theme"

// ─── icon name mappings ─────────────────────────────────

export const StatusIcon: Record<string, IconName> = {
  idle: "idle",
  busy: "busy",
  retry: "retry",
  error: "error",
  success: "success",
}

export const ToolIcon: Record<string, IconName> = {
  bash: "bash",
  glob: "glob",
  read: "read",
  grep: "grep",
  webfetch: "webfetch",
  websearch: "websearch",
  write: "write",
  edit: "edit",
  task: "task",
  execute: "execute",
  apply_patch: "apply_patch",
  todowrite: "todowrite",
  question: "question",
  skill: "skill",
  generic: "generic",
}

export const LabelIcon: Record<string, IconName> = {
  agent: "agent",
  model: "model",
  thinking: "thinking",
  branch: "branch",
  warn: "warn",
  brand: "agent",
  dot: "dot",
  separator: "dot",
}

export const TodoIcon: Record<string, IconName> = {
  completed: "success",
  in_progress: "busy",
  pending: "idle",
}

// ─── navigation & collapse (pixel icons) ─────────────────

export const NavIcon: Record<string, IconName> = {
  up: "arrow_up",
  down: "arrow_down",
  left: "arrow_left",
  right: "arrow_right",
}

export const CollapseIcon: Record<string, IconName> = {
  open: "chevron_down",
  closed: "chevron_right",
}

// ─── types ───────────────────────────────────────────────

export type StatusType = keyof typeof StatusIcon
export type ToolName = keyof typeof ToolIcon

// ─── color helpers ───────────────────────────────────────

function statusColor(theme: Theme, status: StatusType): RGBA {
  if (status === "idle") return theme.success
  if (status === "busy") return theme.warning
  if (status === "retry") return theme.error
  if (status === "error") return theme.error
  if (status === "success") return theme.success
  return theme.text
}

/** shared status → {icon, color} logic, used everywhere */
export function statusInfo(theme: Theme, status: { type: string } | undefined): { icon: IconName; color: RGBA; label: string } {
  if (!status) return { icon: "idle", color: theme.success, label: "idle" }
  if (status.type === "busy") return { icon: "busy", color: theme.warning, label: "busy" }
  if (status.type === "retry") return { icon: "retry", color: theme.error, label: "retry" }
  if (status.type === "error") return { icon: "error", color: theme.error, label: "error" }
  if (status.type === "success") return { icon: "success", color: theme.success, label: "done" }
  return { icon: "idle", color: theme.success, label: "idle" }
}

// ─── unified icon animation ─────────────────────────────
//
// Every animated icon gets a distinct visual rhythm. Animations are
// alpha-only (no pixel re-render) so they're cheap — one Timeline per
// visible icon, auto-cleaned on unmount, globally toggleable via
// `animations_enabled` KV flag.

type AnimParams = {
  speed: number
  minAlpha: number
  maxAlpha: number
  fn: (t: number) => number
}

function animParams(name: IconName): AnimParams | null {
  switch (name) {
    case "busy":
      // Steady medium breath — working state
      return {
        speed: 1000, minAlpha: 0.4, maxAlpha: 1.0,
        fn: (t) => {
          const p = (Math.sin(t / 1000 * Math.PI) + 1) / 2
          return 0.4 + p * 0.6
        },
      }
    case "retry":
      // Urgent erratic pulse — retrying
      return {
        speed: 700, minAlpha: 0.3, maxAlpha: 1.0,
        fn: (t) => {
          const p = (Math.sin(t / 700 * Math.PI * 2) + 1) / 2
          const flicker = (Math.sin(t / 200 * Math.PI) + 1) / 2 * 0.25
          return 0.3 + Math.min(1, p + flicker) * 0.7
        },
      }
    case "idle":
      // Very slow gentle pulse — alive but idle
      return {
        speed: 2400, minAlpha: 0.55, maxAlpha: 1.0,
        fn: (t) => {
          const p = (Math.sin(t / 2400 * Math.PI) + 1) / 2
          return 0.55 + p * 0.45
        },
      }
    case "error":
      // Aggressive double-pulse — alarm
      return {
        speed: 800, minAlpha: 0.25, maxAlpha: 1.0,
        fn: (t) => {
          const a = (Math.sin(t / 800 * Math.PI * 2) + 1) / 2
          const b = (Math.sin(t / 800 * Math.PI * 4 + 0.8) + 1) / 2
          const p = a * 0.6 + b * 0.4
          return 0.25 + p * 0.75
        },
      }
    case "warn":
      // Rhythmic warning blink — attention but not alarm
      return {
        speed: 1500, minAlpha: 0.35, maxAlpha: 1.0,
        fn: (t) => {
          // Square-ish wave for a blinking feel
          const s = Math.sin(t / 1500 * Math.PI * 2)
          const p = s > 0 ? 1 : 0.3
          const ease = (Math.sin(t / 1500 * Math.PI) + 1) / 2
          return 0.35 + (p * 0.5 + ease * 0.5) * 0.65
        },
      }
    case "thinking":
      // Slow gentle pulse — contemplative rhythm
      return {
        speed: 1800, minAlpha: 0.5, maxAlpha: 1.0,
        fn: (t) => {
          const p = (Math.sin(t / 1800 * Math.PI) + 1) / 2
          return 0.5 + p * 0.5
        },
      }
    case "model":
      // Slow steady breath — target rings expand/contract
      return {
        speed: 1800, minAlpha: 0.5, maxAlpha: 1.0,
        fn: (t) => {
          const p = (Math.sin(t / 1800 * Math.PI) + 1) / 2
          return 0.5 + p * 0.5
        },
      }
    case "agent":
      // Medium wave — brain activity
      return {
        speed: 1200, minAlpha: 0.45, maxAlpha: 1.0,
        fn: (t) => {
          const p = (Math.sin(t / 1200 * Math.PI) + 1) / 2
          return 0.45 + p * 0.55
        },
      }
    case "skill":
      // Twinkle — irregular sparkle (two overlapping sine waves)
      return {
        speed: 900, minAlpha: 0.35, maxAlpha: 1.0,
        fn: (t) => {
          const a = (Math.sin(t / 900 * Math.PI) + 1) / 2
          const b = (Math.sin(t / 1530 * Math.PI + 1.5) + 1) / 2
          const p = a * 0.6 + b * 0.4
          return 0.35 + p * 0.65
        },
      }
    case "success":
      // Brief confirmation shimmer — settles to solid, then stops
      return {
        speed: 2000, minAlpha: 0.7, maxAlpha: 1.0,
        fn: (t) => {
          // After decay completes, return solid so the timeline can stop
          if (t > 6000) return 1.0
          // Start bright, fade to solid with a gentle wave
          const decay = Math.exp(-t / 3000)
          const wave = (Math.sin(t / 2000 * Math.PI * 2) + 1) / 2
          return 1 - decay * 0.3 - wave * decay * 0.15
        },
      }
    default:
      return null
  }
}

const ANIMATED_ICONS = new Set<IconName>([
  "busy", "retry", "idle", "error", "warn",
  "agent", "model", "skill", "success",
])

function useIconAlpha(iconName: Accessor<IconName>, active: Accessor<boolean>): Accessor<number> {
  const kv = useKV()
  const animationsEnabled = () => kv.get("animations_enabled", true)
  const [alpha, setAlpha] = createSignal(1)
  let timeline: ReturnType<typeof createTimeline> | null = null

  createEffect(() => {
    if (timeline) {
      timeline.pause()
      engine.unregister(timeline)
      timeline = null
    }
    const name = iconName()
    const params = animParams(name)
    const shouldAnimate = active() && animationsEnabled() && params !== null
    if (!shouldAnimate || !params) {
      setAlpha(1)
      return
    }

    const startTime = Date.now()
    timeline = createTimeline({ duration: 0, loop: true, autoplay: true })
    timeline.call(() => {
      const elapsed = Date.now() - startTime
      const value = params.fn(elapsed)
      setAlpha(value)
      // Stop the timeline once the success shimmer settles to solid
      if (name === "success" && elapsed > 6000) {
        timeline!.pause()
        engine.unregister(timeline!)
        timeline = null
      }
    })
    engine.register(timeline)
  })

  onCleanup(() => {
    if (timeline) {
      timeline.pause()
      engine.unregister(timeline)
    }
  })

  return alpha
}

// ─── thinking braille spinner ───────────────────────────
//
// Uses a braille dot-scanning pattern (dots7 from cli-spinners) that
// sweeps left-to-right and back, evoking a contemplative rhythm.
// Single-char frames keep it compact for inline label use.

const THINKING_FRAMES = ["⠈", "⠉", "⠋", "⠓", "⠒", "⠐", "⠐", "⠒", "⠖", "⠦", "⠤", "⠠", "⠠", "⠤", "⠦", "⠖", "⠒", "⠐", "⠐", "⠒", "⠓", "⠋", "⠉", "⠈"]

function ThinkingScanner(props: { fg?: RGBA }) {
  const { theme } = useTheme()
  const color = () => props.fg ?? theme.warning

  return <spinner frames={THINKING_FRAMES} interval={80} color={color()} />
}

// ─── components ─────────────────────────────────────────

export function StatusIndicator(props: { status: StatusType; title?: string }) {
  const { theme } = useTheme()
  const iconName = createMemo(() => StatusIcon[props.status] ?? "idle")
  const color = createMemo(() => statusColor(theme, props.status))
  const alpha = useIconAlpha(iconName, () => true)

  return (
    <box flexDirection="row" gap={1} alignItems="center" opacity={alpha()}>
      <PixelIcon icon={iconName()} fg={color()} />
      <Show when={props.title}>
        <text fg={color()}>{props.title}</text>
      </Show>
    </box>
  )
}

export function Icon(props: { name: ToolName; fg?: RGBA }) {
  const { theme } = useTheme()
  const iconName = createMemo(() => ToolIcon[props.name] ?? "generic")
  const alpha = useIconAlpha(iconName, () => true)

  return (
    <Show when={ANIMATED_ICONS.has(iconName())} fallback={<PixelIcon icon={iconName()} fg={props.fg ?? theme.textMuted} />}>
      <box opacity={alpha()}>
        <PixelIcon icon={iconName()} fg={props.fg ?? theme.textMuted} />
      </box>
    </Show>
  )
}

export function Label(props: { icon: keyof typeof LabelIcon; fg?: RGBA; active?: boolean }) {
  const { theme } = useTheme()
  const iconName = createMemo(() => LabelIcon[props.icon] ?? "dot")
  const isActive = () => props.active ?? true
  const alpha = useIconAlpha(iconName, isActive)
  const isThinking = createMemo(() => iconName() === "thinking")

  return (
    <Show when={isThinking() && isActive()} fallback={
      <Show when={ANIMATED_ICONS.has(iconName())} fallback={<PixelIcon icon={iconName()} fg={props.fg ?? theme.textMuted} />}>
        <box opacity={alpha()}>
          <PixelIcon icon={iconName()} fg={props.fg ?? theme.textMuted} />
        </box>
      </Show>
    }>
      <ThinkingScanner fg={props.fg ?? theme.textMuted} />
    </Show>
  )
}

/**
 * Smart icon that auto-animates for known animated icon names
 * (busy/retry/idle/error/warn/agent/model/thinking/skill/success)
 * and stays static for everything else. Drop-in replacement for PixelIcon.
 */
export function AnimatedIcon(props: { icon: IconName; fg?: RGBA }) {
  const { theme } = useTheme()
  const iconName = createMemo(() => props.icon)
  const alpha = useIconAlpha(iconName, () => true)
  const isThinking = createMemo(() => props.icon === "thinking")

  return (
    <Show when={isThinking()} fallback={
      <Show when={ANIMATED_ICONS.has(props.icon)} fallback={<PixelIcon icon={props.icon} fg={props.fg ?? theme.textMuted} />}>
        <box opacity={alpha()}>
          <PixelIcon icon={props.icon} fg={props.fg ?? theme.textMuted} />
        </box>
      </Show>
    }>
      <ThinkingScanner fg={props.fg ?? theme.textMuted} />
    </Show>
  )
}

export function CollapseButton(props: { open: boolean; fg?: RGBA }) {
  const { theme } = useTheme()
  const iconName = createMemo(() => props.open ? CollapseIcon.open : CollapseIcon.closed)
  return <PixelIcon icon={iconName()} fg={props.fg ?? theme.text} />
}
