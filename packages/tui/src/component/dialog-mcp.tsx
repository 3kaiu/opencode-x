import { createMemo, createSignal } from "solid-js"
import { useLocal } from "../context/local"
import { useData } from "../context/data"
import { map, pipe, entries, sortBy } from "remeda"
import { DialogSelect, type DialogSelectOption } from "../ui/dialog-select"
import { useTheme } from "../context/theme"
import { TextAttributes } from "@opentui/core"
import { useSDK } from "../context/sdk"
import { GLYPH } from "../ui/glyphs"
import { useLocale } from "../context/locale"

function Status(props: { enabled: boolean; loading: boolean }) {
  const { theme } = useTheme()
  const locale = useLocale()
  if (props.loading) {
    return <span style={{ fg: theme.textMuted }}>{GLYPH.mcp.loading} {locale.t("mcp.loading")}</span>
  }
  if (props.enabled) {
    return (
      <span style={{ fg: theme.success, attributes: TextAttributes.BOLD }}>
        {GLYPH.mcp.connected} {locale.t("mcp.enabled")}
      </span>
    )
  }
  return (
    <span style={{ fg: theme.textMuted }}>
      {GLYPH.mcp.disabled} {locale.t("mcp.disabled")}
    </span>
  )
}

export function DialogMcp() {
  const local = useLocal()
  const sync = useData()
  const sdk = useSDK()
  const { theme } = useTheme()
  const locale = useLocale()
  const [loading, setLoading] = createSignal<string | null>(null)

  const options = createMemo(() => {
    // Track sync data and loading state to trigger re-render when they change
    const mcpData = sync.instance.mcp
    const loadingMcp = loading()

    return pipe(
      mcpData ?? {},
      entries(),
      sortBy(([name]) => name),
      map(([name, status]) => ({
        value: name,
        title: name,
        description: status.status,
        footer: <Status enabled={local.mcp.isEnabled(name)} loading={loadingMcp === name} />,
        category: undefined,
      })),
    )
  })

  const actions = createMemo(() => [
    {
      command: "dialog.mcp.toggle",
      title: locale.t("mcp.action.toggle"),
      onTrigger: async (option: DialogSelectOption<string>) => {
        // Prevent toggling while an operation is already in progress
        if (loading() !== null) return

        setLoading(option.value)
        try {
          await local.mcp.toggle(option.value)
          // Refresh MCP status from server
          const status = await sdk.client.mcp.status()
          if (status.data) {
            sync.instance.set("mcp", status.data)
          } else {
            console.error("Failed to refresh MCP status: no data returned")
          }
        } catch (error) {
          console.error("Failed to toggle MCP:", error)
        } finally {
          setLoading(null)
        }
      },
    },
  ])

  return (
    <DialogSelect
      title={locale.t("mcp.title")}
      options={options()}
      emptyView={
        Object.keys(sync.instance.mcp).length === 0 ? (
          <box paddingLeft={4} paddingRight={4} paddingTop={1}>
            <text fg={theme.textMuted}>{locale.t("mcp.empty")}</text>
          </box>
        ) : undefined
      }
      actions={actions()}
      onSelect={(_option) => {
        // Don't close on select, only on escape
      }}
    />
  )
}
