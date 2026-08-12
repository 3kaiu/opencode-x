import { TextAttributes } from "@opentui/core"
import { createStore } from "solid-js/store"
import { For } from "solid-js"
import { selectedForeground, useTheme } from "../context/theme"
import { useLocale } from "../context/locale"
import { useDialog } from "../ui/dialog"
import { useBindings } from "../keymap"

export function DialogWorkspaceUnavailable(props: { onRestore?: () => boolean | void | Promise<boolean | void> }) {
  const dialog = useDialog()
  const { theme } = useTheme()
  const locale = useLocale()
  const [store, setStore] = createStore({
    active: "restore" as "cancel" | "restore",
  })

  const options = ["cancel", "restore"] as const

  async function confirm() {
    if (store.active === "cancel") {
      dialog.clear()
      return
    }
    const result = await props.onRestore?.()
    if (result === false) return
    dialog.clear()
  }

  useBindings(() => ({
    bindings: [
      { key: "return", desc: locale.t("workspace.confirmOption"), group: "Dialog", cmd: () => void confirm() },
      { key: "left", desc: locale.t("workspace.cancelRestore"), group: "Dialog", cmd: () => setStore("active", "cancel") },
      { key: "right", desc: locale.t("workspace.restoreAction"), group: "Dialog", cmd: () => setStore("active", "restore") },
    ],
  }))

  return (
    <box paddingLeft={2} paddingRight={2} gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={theme.text}>
          {locale.t("workspace.unavailableTitle")}
        </text>
        <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
          esc
        </text>
      </box>
      <text fg={theme.textMuted} wrapMode="word">
        {locale.t("workspace.unavailableBody")}
      </text>
      <text fg={theme.textMuted} wrapMode="word">
        {locale.t("workspace.unavailableRestore")}
      </text>
      <box flexDirection="row" justifyContent="flex-end" paddingBottom={1} gap={1}>
        <For each={options}>
          {(item) => (
            <box
              paddingLeft={2}
              paddingRight={2}
              backgroundColor={item === store.active ? theme.primary : undefined}
              onMouseUp={() => {
                setStore("active", item)
                void confirm()
              }}
            >
              <text fg={item === store.active ? selectedForeground(theme) : theme.textMuted}>
                {item === "cancel" ? locale.t("permission.cancel") : locale.t("workspace.restoreAction")}
              </text>
            </box>
          )}
        </For>
      </box>
    </box>
  )
}
