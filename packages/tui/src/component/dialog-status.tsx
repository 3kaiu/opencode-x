import { TextAttributes } from "@opentui/core"
import { fileURLToPath } from "bun"
import { useTheme } from "../context/theme"
import { useDialog } from "../ui/dialog"
import { useData } from "../context/data"
import { useLocale } from "../context/locale"
import { For, Match, Switch, Show, createMemo } from "solid-js"
import { GLYPH } from "../ui/glyphs"

export function DialogStatus() {
  const sync = useData()
  const { theme } = useTheme()
  const locale = useLocale()
  const dialog = useDialog()

  const enabledFormatters = createMemo(() => sync.instance.formatter.filter((f) => f.enabled))

  const plugins = createMemo(() => {
    const list = sync.instance.config.plugin ?? []
    const result = list.map((item) => {
      const value = typeof item === "string" ? item : item[0]
      if (value.startsWith("file://")) {
        const path = fileURLToPath(value)
        const parts = path.split("/")
        const filename = parts.pop() || path
        if (!filename.includes(".")) return { name: filename }
        const basename = filename.split(".")[0]
        if (basename === "index") {
          const dirname = parts.pop()
          const name = dirname || basename
          return { name }
        }
        return { name: basename }
      }
      const index = value.lastIndexOf("@")
      if (index <= 0) return { name: value, version: "latest" }
      const name = value.substring(0, index)
      const version = value.substring(index + 1)
      return { name, version }
    })
    return result.toSorted((a, b) => a.name.localeCompare(b.name))
  })

  return (
    <box paddingLeft={2} paddingRight={2} gap={1} paddingBottom={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          {locale.t("status.title")}
        </text>
        <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
          esc
        </text>
      </box>
      <Show when={Object.keys(sync.instance.mcp).length > 0} fallback={<text fg={theme.textMuted}>{locale.t("status.mcpServersNone")}</text>}>
        <box>
          <text fg={theme.text}>{locale.t("status.mcpServers", { count: Object.keys(sync.instance.mcp).length })}</text>
          <For each={Object.entries(sync.instance.mcp)}>
            {([key, item]) => (
              <box flexDirection="row" gap={1}>
                <text
                  flexShrink={0}
                  style={{
                    fg: (
                      {
                        connected: theme.success,
                        failed: theme.error,
                        disabled: theme.textMuted,
                        needs_auth: theme.warning,
                        needs_client_registration: theme.error,
                      } as Record<string, typeof theme.success>
                    )[item.status],
                  }}
                >
                  {(
                    {
                      connected: GLYPH.mcp.connected,
                      failed: GLYPH.mcp.failed,
                      disabled: GLYPH.mcp.disabled,
                      needs_auth: GLYPH.mcp.connected,
                      needs_client_registration: GLYPH.mcp.failed,
                    } as Record<string, string>
                  )[item.status] ?? GLYPH.mcp.connected}
                </text>
                <text fg={theme.text} wrapMode="word">
                  <b>{key}</b>{" "}
                  <span style={{ fg: theme.textMuted }}>
                    <Switch fallback={item.status}>
                      <Match when={item.status === "connected"}>{locale.t("status.mcp.connected")}</Match>
                      <Match when={item.status === "failed" && item}>{(val) => val().error}</Match>
                      <Match when={item.status === "disabled"}>{locale.t("status.mcp.disabled")}</Match>
                      <Match when={(item.status as string) === "needs_auth"}>
                        {locale.t("status.mcp.needsAuth", { key })}
                      </Match>
                      <Match when={(item.status as string) === "needs_client_registration" && item}>
                        {(val) => (val() as { error: string }).error}
                      </Match>
                    </Switch>
                  </span>
                </text>
              </box>
            )}
          </For>
        </box>
      </Show>
      <Show when={sync.instance.lsp.length > 0} fallback={<text fg={theme.textMuted}>{locale.t("status.lspServersNone")}</text>}>
        <box>
          <text fg={theme.text}>{locale.t("status.lspServers", { count: sync.instance.lsp.length })}</text>
          <For each={sync.instance.lsp}>
            {(item) => (
              <box flexDirection="row" gap={1}>
                <text
                  flexShrink={0}
                  style={{
                    fg: {
                      connected: theme.success,
                      error: theme.error,
                    }[item.status],
                  }}
                >
                  {item.status === "error" ? GLYPH.mcp.failed : GLYPH.mcp.connected}
                </text>
                <text fg={theme.text} wrapMode="word">
                  <b>{item.id}</b> <span style={{ fg: theme.textMuted }}>{item.root}</span>
                </text>
              </box>
            )}
          </For>
        </box>
      </Show>
      <Show when={enabledFormatters().length > 0} fallback={<text fg={theme.textMuted}>{locale.t("status.formattersNone")}</text>}>
        <box>
          <text fg={theme.text}>{locale.t("status.formatters", { count: enabledFormatters().length })}</text>
          <For each={enabledFormatters()}>
            {(item) => (
              <box flexDirection="row" gap={1}>
                <text
                  flexShrink={0}
                  style={{
                    fg: theme.success,
                  }}
                >
                  •
                </text>
                <text wrapMode="word" fg={theme.text}>
                  <b>{item.name}</b>
                </text>
              </box>
            )}
          </For>
        </box>
      </Show>
      <Show when={plugins().length > 0} fallback={<text fg={theme.textMuted}>{locale.t("status.pluginsNone")}</text>}>
        <box>
          <text fg={theme.text}>{locale.t("status.plugins", { count: plugins().length })}</text>
          <For each={plugins()}>
            {(item) => (
              <box flexDirection="row" gap={1}>
                <text
                  flexShrink={0}
                  style={{
                    fg: theme.success,
                  }}
                >
                  •
                </text>
                <text wrapMode="word" fg={theme.text}>
                  <b>{item.name}</b>
                  {item.version && <span style={{ fg: theme.textMuted }}> @{item.version}</span>}
                </text>
              </box>
            )}
          </For>
        </box>
      </Show>
    </box>
  )
}
