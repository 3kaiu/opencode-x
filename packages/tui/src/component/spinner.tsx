import { Show } from "solid-js"
import { useTheme } from "../context/theme"
import { useKV } from "../context/kv"
import type { JSX } from "@opentui/solid"
import type { RGBA } from "@opentui/core"
import { BRAILLE_FRAMES, GLYPH } from "../ui/glyphs"
import { registerOpencodeSpinner } from "./register-spinner"

registerOpencodeSpinner()

export function Spinner(props: { children?: JSX.Element; color?: RGBA }) {
  const { theme } = useTheme()
  const kv = useKV()
  const color = () => props.color ?? theme.textMuted
  return (
    <Show
      when={kv.get("animations_enabled", true)}
      fallback={
        <text fg={color()}>
          {GLYPH.idleSpinner} {props.children}
        </text>
      }
    >
      <box flexDirection="row" gap={1}>
        <spinner frames={BRAILLE_FRAMES} interval={80} color={color()} />
        <Show when={props.children}>
          <text fg={color()}>{props.children}</text>
        </Show>
      </box>
    </Show>
  )
}
