import { Show, createSignal, onCleanup, createMemo, createEffect } from "solid-js"
import { useTheme } from "../context/theme"
import { useKV } from "../context/kv"
import type { JSX } from "@opentui/solid"
import type { RGBA } from "@opentui/core"

export const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]

export function Spinner(props: { children?: JSX.Element; color?: RGBA }) {
  const { theme } = useTheme()
  const kv = useKV()
  const color = () => props.color ?? theme.textMuted
  const [frame, setFrame] = createSignal(0)

  const enabled = createMemo(() => kv.get("animations_enabled", true))
  createEffect(() => {
    if (!enabled()) return
    const id = setInterval(() => setFrame((f) => (f + 1) % SPINNER_FRAMES.length), 80)
    onCleanup(() => clearInterval(id))
  })

  return (
    <Show when={enabled()} fallback={<text fg={color()}>⋯ {props.children}</text>}>
      <box flexDirection="row" gap={1} alignItems="center">
        <text fg={color()}>{SPINNER_FRAMES[frame()]}</text>
        <Show when={props.children}>
          <text fg={color()}>{props.children}</text>
        </Show>
      </box>
    </Show>
  )
}