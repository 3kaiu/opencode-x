import { TextAttributes } from "@opentui/core"
import { selectedForeground, useTheme } from "../context/theme"
import { useLocale } from "../context/locale"
import { useDialog } from "../ui/dialog"
import { createStore } from "solid-js/store"
import { For } from "solid-js"
import { useBindings } from "../keymap"

export function DialogSessionDeleteFailed(props: {
  session: string
  workspace: string
  onDelete?: () => boolean | void | Promise<boolean | void>
  onRestore?: () => boolean | void | Promise<boolean | void>
  onDone?: () => void
}) {
  const dialog = useDialog()
  const { theme } = useTheme()
  const locale = useLocale()
  const [store, setStore] = createStore({
    active: "delete" as "delete" | "restore",
  })

  const options = [
    {
      id: "delete" as const,
      title: locale.t("recovery.deleteTitle"),
      description: locale.t("recovery.deleteDescription"),
      run: props.onDelete,
    },
    {
      id: "restore" as const,
      title: locale.t("recovery.restoreTitle"),
      description: locale.t("recovery.restoreDescription"),
      run: props.onRestore,
    },
  ]

  async function confirm() {
    const result = await options.find((item) => item.id === store.active)?.run?.()
    if (result === false) return
    props.onDone?.()
    if (!props.onDone) dialog.clear()
  }

  useBindings(() => ({
    bindings: [
      { key: "return", desc: locale.t("recovery.confirmOption"), group: "Dialog", cmd: () => void confirm() },
      { key: "left", desc: locale.t("recovery.focusDelete"), group: "Dialog", cmd: () => setStore("active", "delete") },
      { key: "up", desc: locale.t("recovery.focusDelete"), group: "Dialog", cmd: () => setStore("active", "delete") },
      { key: "right", desc: locale.t("recovery.focusRestore"), group: "Dialog", cmd: () => setStore("active", "restore") },
      { key: "down", desc: locale.t("recovery.focusRestore"), group: "Dialog", cmd: () => setStore("active", "restore") },
    ],
  }))

  return (
    <box paddingLeft={2} paddingRight={2} gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={theme.text}>
          {locale.t("recovery.title")}
        </text>
        <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
          esc
        </text>
      </box>
      <text fg={theme.textMuted} wrapMode="word">
        {locale.t("recovery.sessionDeleted", { session: props.session, workspace: props.workspace })}
      </text>
      <text fg={theme.textMuted} wrapMode="word">
        {locale.t("recovery.choose")}
      </text>
      <box flexDirection="column" paddingBottom={1} gap={1}>
        <For each={options}>
          {(item) => (
            <box
              flexDirection="column"
              paddingLeft={2}
              paddingRight={2}
              paddingTop={1}
              paddingBottom={1}
              backgroundColor={item.id === store.active ? theme.primary : undefined}
              onMouseUp={() => {
                setStore("active", item.id)
                void confirm()
              }}
            >
              <text
                attributes={TextAttributes.BOLD}
                fg={item.id === store.active ? selectedForeground(theme) : theme.text}
              >
                {item.title}
              </text>
              <text fg={item.id === store.active ? selectedForeground(theme) : theme.textMuted} wrapMode="word">
                {item.description}
              </text>
            </box>
          )}
        </For>
      </box>
    </box>
  )
}
