import type { TuiPlugin, TuiPluginApi } from "@opencode-ai/plugin/tui"
import type { BuiltinTuiPlugin } from "../builtins"
import { createMemo, Show } from "solid-js"
import { TextAttributes } from "@opentui/core"
import { abbreviateHome } from "../../runtime"
import { useTuiPaths } from "../../context/runtime"
import { useHomeSessionDestination } from "../../routes/home/session-destination"

const id = "internal:home-footer"

function Directory(props: { api: TuiPluginApi }) {
  const theme = () => props.api.theme.current
  const destination = useHomeSessionDestination()
  const paths = useTuiPaths()
  const dir = createMemo(() => {
    const selected = destination?.destination()
    if (!selected || selected.type === "new") return
    const out = abbreviateHome(selected.directory, paths.home)
    const branch =
      selected.directory === (props.api.state.path.directory || paths.cwd) ? props.api.state.vcs?.branch : undefined
    if (branch) return out + ":" + branch
    return out
  })

  return (
    <Show when={dir()}>
      {(value) => (
        <box flexDirection="row" gap={1} flexShrink={0} alignItems="center">
          <text fg={theme().borderSubtle}>📁</text>
          <text fg={theme().textMuted}>{value()}</text>
        </box>
      )}
    </Show>
  )
}

function Mcp(props: { api: TuiPluginApi }) {
  const theme = () => props.api.theme.current
  const list = createMemo(() => props.api.state.mcp())
  const has = createMemo(() => list().length > 0)
  const err = createMemo(() => list().some((item) => item.status === "failed"))
  const count = createMemo(() => list().filter((item) => item.status === "connected").length)
  const total = createMemo(() => list().length)

  const statusIcon = createMemo(() => {
    if (err()) return { icon: "✗", color: theme().error }
    if (count() > 0) return { icon: "●", color: theme().success }
    return { icon: "○", color: theme().textMuted }
  })

  return (
    <Show when={has()}>
      <box gap={1} flexDirection="row" flexShrink={0} alignItems="center">
        <text fg={statusIcon().color} attributes={TextAttributes.BOLD}>
          {statusIcon().icon}
        </text>
        <text fg={theme().text} attributes={TextAttributes.BOLD}>
          {count()}
          <text fg={theme().textMuted}>/{total()} MCP</text>
        </text>
        <text fg={theme().textMuted}>/status</text>
      </box>
    </Show>
  )
}

function SessionCount(props: { api: TuiPluginApi }) {
  const theme = () => props.api.theme.current
  const count = createMemo(() => props.api.state.session.count())
  const show = createMemo(() => count() > 0)

  return (
    <Show when={show()}>
      <box flexDirection="row" gap={1} flexShrink={0} alignItems="center">
        <text fg={theme().borderSubtle}>💬</text>
        <text fg={theme().text} attributes={TextAttributes.BOLD}>
          {count()}
        </text>
        <text fg={theme().textMuted}>{count() === 1 ? "session" : "sessions"}</text>
      </box>
    </Show>
  )
}

function Version(props: { api: TuiPluginApi }) {
  const theme = () => props.api.theme.current

  return (
    <box flexShrink={0} flexDirection="row" gap={1} alignItems="center">
      <text fg={theme().success}>●</text>
      <text fg={theme().text} attributes={TextAttributes.BOLD}>
        Open
        <text fg={theme().text}>Code</text>
      </text>
      <text fg={theme().textMuted}>{props.api.app.version}</text>
    </box>
  )
}

function View(props: { api: TuiPluginApi }) {
  const theme = () => props.api.theme.current

  return (
    <box
      width="100%"
      paddingTop={1}
      paddingBottom={1}
      paddingLeft={2}
      paddingRight={2}
      flexDirection="row"
      flexShrink={0}
      gap={2}
      border={["top"]}
      borderColor={theme().borderSubtle}
      alignItems="center"
    >
      <Directory api={props.api} />
      <SessionCount api={props.api} />
      <Mcp api={props.api} />
      <box flexGrow={1} />
      <Version api={props.api} />
    </box>
  )
}

const tui: TuiPlugin = async (api) => {
  api.slots.register({
    order: 100,
    slots: {
      home_footer() {
        return <View api={api} />
      },
    },
  })
}

const plugin: BuiltinTuiPlugin = {
  id,
  tui,
}

export default plugin
