import { createContext, useContext, type ParentProps, Show, createMemo } from "solid-js"
import { createStore } from "solid-js/store"
import { useTheme } from "../context/theme"
import { useTerminalDimensions, useKeyboard } from "@opentui/solid"
import { SplitBorder } from "./border"
import { GLYPH } from "./glyphs"
import { TextAttributes } from "@opentui/core"

export type ToastOptions = {
  title?: string
  message: string
  variant: "info" | "success" | "warning" | "error"
  duration: number
}
type ToastInput = Omit<ToastOptions, "duration"> & { duration?: number }

// Variant-specific default durations (ms). Success is short, errors linger.
const VARIANT_DURATION: Record<ToastOptions["variant"], number> = {
  success: 3000,
  info: 4000,
  warning: 5000,
  error: 8000,
}

// Variant indicator glyphs for at-a-glance recognition.
const VARIANT_ICON: Record<ToastOptions["variant"], string> = {
  success: GLYPH.check,
  info: GLYPH.info,
  warning: GLYPH.warning,
  error: GLYPH.cross,
}

export function Toast() {
  const toast = useToast()
  const { theme } = useTheme()
  const dimensions = useTerminalDimensions()

  // ESC dismisses the current toast.
  useKeyboard((evt) => {
    if (!toast.currentToast) return
    if (evt.name === "escape") {
      evt.preventDefault()
      evt.stopPropagation()
      toast.dismiss()
    }
  })

  const maxWidth = createMemo(() => Math.min(72, Math.max(40, dimensions().width - 6)))

  return (
    <Show when={toast.currentToast}>
      {(current) => (
        <box
          position="absolute"
          justifyContent="center"
          alignItems="flex-start"
          top={2}
          right={2}
          maxWidth={maxWidth()}
          paddingLeft={1}
          paddingRight={2}
          paddingTop={1}
          paddingBottom={1}
          backgroundColor={theme.backgroundPanel}
          borderColor={theme[current().variant]}
          border={["left"]}
          customBorderChars={SplitBorder.customBorderChars}
        >
          <box flexDirection="row" gap={1} alignItems="flex-start" width="100%">
            <text flexShrink={0} fg={theme[current().variant]} attributes={TextAttributes.BOLD}>
              {VARIANT_ICON[current().variant]}
            </text>
            <box flexDirection="column" flexGrow={1} flexShrink={1} width="100%">
              <Show when={current().title}>
                <text attributes={TextAttributes.BOLD} marginBottom={1} fg={theme.text}>
                  {current().title}
                </text>
              </Show>
              <text fg={theme.text} wrapMode="word" width="100%">
                {current().message}
              </text>
            </box>
          </box>
        </box>
      )}
    </Show>
  )
}

function init() {
  const [store, setStore] = createStore({
    currentToast: null as ToastOptions | null,
  })

  let timeoutHandle: NodeJS.Timeout | null = null
  // Dedup window: if an identical toast (same message + variant) arrives
  // within this window, skip it rather than re-triggering the animation.
  const DEDUP_WINDOW = 1500
  let lastMessage: string | undefined
  let lastVariant: ToastOptions["variant"] | undefined
  let lastShownAt = 0

  const toast = {
    show(options: ToastInput) {
      const variant = options.variant
      const message = options.message
      const now = Date.now()

      // Deduplicate consecutive identical toasts within the dedup window.
      if (
        message === lastMessage &&
        variant === lastVariant &&
        now - lastShownAt < DEDUP_WINDOW
      ) {
        return
      }
      lastMessage = message
      lastVariant = variant
      lastShownAt = now

      const toastOptions = {
        ...options,
        duration: options.duration ?? VARIANT_DURATION[variant],
      }
      setStore("currentToast", toastOptions)
      if (timeoutHandle) clearTimeout(timeoutHandle)
      timeoutHandle = setTimeout(() => {
        setStore("currentToast", null)
      }, toastOptions.duration).unref()
    },
    // Brief feedback for lightweight actions (copy, etc.)
    // Shows for 1.2s with a compact, non-intrusive style.
    quick(message: string, variant: ToastOptions["variant"] = "success") {
      toast.show({ message, variant, duration: 1200 })
    },
    dismiss() {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle)
        timeoutHandle = null
      }
      setStore("currentToast", null)
    },
    error: (err: unknown) => {
      if (err instanceof Error)
        return toast.show({
          variant: "error",
          message: err.message,
        })
      toast.show({
        variant: "error",
        message: "An unknown error has occurred",
      })
    },
    get currentToast(): ToastOptions | null {
      return store.currentToast
    },
  }
  return toast
}

export type ToastContext = ReturnType<typeof init>

const ctx = createContext<ToastContext>()

export function ToastProvider(props: ParentProps) {
  const value = init()
  return <ctx.Provider value={value}>{props.children}</ctx.Provider>
}

export function useToast() {
  const value = useContext(ctx)
  if (!value) {
    throw new Error("useToast must be used within a ToastProvider")
  }
  return value
}
