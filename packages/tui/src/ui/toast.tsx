import { createContext, useContext, type ParentProps, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useTheme } from "../context/theme"
import { useTerminalDimensions } from "@opentui/solid"
import { TextAttributes } from "@opentui/core"
import { space } from "../design-tokens"
import { AnimatedIcon } from "../ui/icon"
import type { IconName } from "../util/icon-pixel-data"

export type ToastOptions = {
  title?: string
  message: string
  variant: "info" | "success" | "warning" | "error"
  duration: number
}
type ToastInput = Omit<ToastOptions, "duration"> & { duration?: number }

const VARIANT_ICON: Record<string, IconName> = {
  info: "dot",
  success: "success",
  warning: "warn",
  error: "error",
}

export function Toast() {
  const toast = useToast()
  const { theme } = useTheme()
  const dimensions = useTerminalDimensions()

  return (
    <Show when={toast.currentToast}>
      {(current) => (
        <box
          position="absolute"
          zIndex={4000}
          justifyContent="center"
          alignItems="flex-start"
          top={2}
          right={2}
          maxWidth={Math.min(60, dimensions().width - 6)}
          borderColor={theme[current().variant]}
          border={["left"]}
        >
          <box
            paddingLeft={space.sm}
            paddingRight={space.sm}
            paddingTop={space.xs}
            paddingBottom={space.xs}
            backgroundColor={theme.backgroundPanel}
            borderColor={theme.borderSubtle}
            border={["top", "bottom"]}
          >
            <box flexDirection="row" gap={1}>
              <AnimatedIcon icon={VARIANT_ICON[current().variant] ?? "dot" as IconName} fg={theme[current().variant]} />
              <box>
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

  const toast = {
    show(options: ToastInput) {
      const toastOptions = { ...options, duration: options.duration ?? 3000 }
      setStore("currentToast", toastOptions)
      if (timeoutHandle) clearTimeout(timeoutHandle)
      timeoutHandle = setTimeout(() => {
        setStore("currentToast", null)
      }, toastOptions.duration).unref()
    },
    error: (err: any) => {
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
