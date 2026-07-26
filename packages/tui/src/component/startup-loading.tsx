import { createEffect, createMemo, createSignal, onCleanup, Show } from "solid-js"
import { useTheme } from "../context/theme"
import { Spinner } from "./spinner"
import { useKV } from "../context/kv"

export function StartupLoading(props: { ready: () => boolean }) {
  const theme = useTheme().theme
  const kv = useKV()
  const animationsEnabled = createMemo(() => kv.get("animations_enabled", true))
  const [show, setShow] = createSignal(false)
  const text = createMemo(() => (props.ready() ? "Finishing startup..." : "Loading plugins..."))
  let wait: NodeJS.Timeout | undefined
  let hold: NodeJS.Timeout | undefined

  createEffect(() => {
    if (props.ready()) {
      if (wait) {
        clearTimeout(wait)
        wait = undefined
      }
      if (!show()) return
      if (hold) return

      // Once ready, hold the spinner briefly so it doesn't flash and vanish
      // in the same frame on fast startups. The hold is short (500ms) and
      // does not cap the total display during slow startups — the spinner
      // stays visible until ready() is true.
      const HOLD_AFTER_READY = 500
      hold = setTimeout(() => {
        hold = undefined
        setShow(false)
      }, HOLD_AFTER_READY).unref()
      return
    }

    if (hold) {
      clearTimeout(hold)
      hold = undefined
    }
    if (show()) return
    if (wait) return

    // Reduced from 500ms to 250ms so the user sees feedback sooner on
    // slower startups without flickering on fast ones.
    wait = setTimeout(() => {
      wait = undefined
      setShow(true)
    }, 250).unref()
  })

  onCleanup(() => {
    if (wait) clearTimeout(wait)
    if (hold) clearTimeout(hold)
  })

  return (
    <Show when={show()}>
      <box position="absolute" zIndex={5000} left={0} right={0} bottom={1} justifyContent="center" alignItems="center">
        <box backgroundColor={theme.backgroundPanel} paddingLeft={1} paddingRight={1}>
          <Show when={animationsEnabled()} fallback={<text fg={theme.textMuted}>⋯ {text()}</text>}>
            <Spinner color={theme.textMuted}>{text()}</Spinner>
          </Show>
        </box>
      </box>
    </Show>
  )
}
