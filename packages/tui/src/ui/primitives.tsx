import { createMemo, createSignal, Show, type JSX } from "solid-js"
import { useTheme } from "../context/theme"
import { space, borderVariant } from "../design-tokens"
import { CollapseButton } from "./icon"

type SurfaceLevel = 0 | 1 | 2 | 3 | 4

function levelBg(theme: ReturnType<typeof useTheme>["theme"], level: SurfaceLevel) {
  if (level === 0) return theme.background
  if (level === 1) return theme.backgroundPanel
  if (level === 2) return theme.backgroundElement
  if (level === 3) return theme.backgroundElevated
  return theme.surfaceHover
}

export function Surface(props: {
  level?: SurfaceLevel
  hover?: boolean
  padding?: number
  paddingLeft?: number
  paddingRight?: number
  paddingTop?: number
  paddingBottom?: number
  border?: keyof typeof borderVariant
  borderColor?: JSX.CSSProperties["color"]
  flexGrow?: number
  flexShrink?: number
  flexDirection?: "row" | "column"
  gap?: number
  children: JSX.Element
}) {
  const { theme } = useTheme()
  const [hovered, setHovered] = createSignal(false)
  const level = props.level ?? 0
  const bg = createMemo(() => {
    if (!props.hover) return levelBg(theme, level)
    return hovered() ? (theme.surfaceHover ?? theme.backgroundElement) : levelBg(theme, level)
  })
  const bv = props.border ? borderVariant[props.border] : borderVariant.none
  const padLR = props.padding ?? space.sm
  const padTB = props.padding ?? space.xs
  return (
    <box
      backgroundColor={bg()}
      onMouseOver={() => props.hover && setHovered(true)}
      onMouseOut={() => props.hover && setHovered(false)}
      paddingLeft={props.paddingLeft ?? padLR}
      paddingRight={props.paddingRight ?? padLR}
      paddingTop={props.paddingTop ?? padTB}
      paddingBottom={props.paddingBottom ?? padTB}
      flexGrow={props.flexGrow}
      flexShrink={props.flexShrink}
      flexDirection={props.flexDirection}
      gap={props.gap}
      border={bv.border as any}
      customBorderChars={"customBorderChars" in bv ? bv.customBorderChars as any : undefined}
      borderColor={props.borderColor}
    >
      {props.children}
    </box>
  )
}

export function Divider(props: {
  variant?: "subtle" | "accent"
  label?: string
  color?: JSX.CSSProperties["color"]
}) {
  const { theme } = useTheme()
  const borderColor = props.color ?? (props.variant === "accent" ? theme.borderActive : theme.borderSubtle)
  return (
    <box
      border={["top"]}
      borderColor={borderColor}
      title={props.label}
      titleAlignment="center"
      marginTop={space.xs}
      marginBottom={space.xs}
    />
  )
}

type BadgeVariant = "primary" | "success" | "warning" | "error" | "subtle"

export function Badge(props: {
  variant?: BadgeVariant
  icon?: string
  children: JSX.Element
}) {
  const { theme } = useTheme()
  const variant = props.variant ?? "subtle"
  const color = createMemo(() => {
    if (variant === "primary") return theme.primary
    if (variant === "success") return theme.success
    if (variant === "warning") return theme.warning
    if (variant === "error") return theme.error
    return theme.textMuted
  })
  const textColor = createMemo(() => {
    if (variant === "subtle") return theme.textMuted
    return theme.onPrimary ?? theme.text
  })
  return (
    <box flexDirection="row" gap={space.xs} flexShrink={0}>
      <Show when={props.icon}>
        <text fg={color()}>{props.icon}</text>
      </Show>
      <text fg={textColor()}>{props.children}</text>
    </box>
  )
}

export { CollapseButton }
