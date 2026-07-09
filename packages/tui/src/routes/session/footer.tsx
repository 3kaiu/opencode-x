import { createMemo, Match, onCleanup, onMount, Show, Switch } from "solid-js"
import { useTheme } from "../../context/theme"
import { useSync } from "../../context/sync"
import { useDirectory } from "../../context/directory"
import { useConnected } from "../../component/use-connected"
import { createStore } from "solid-js/store"
import { useRoute } from "../../context/route"
import { useLocal } from "../../context/local"
import { useThinkingMode } from "../../context/thinking"
import * as Model from "../../util/model"

export function Footer() {
  const { theme } = useTheme()
  const sync = useSync()
  const route = useRoute()
  const local = useLocal()
  const thinking = useThinkingMode()
  const mcp = createMemo(() => Object.values(sync.data.mcp).filter((x) => x.status === "connected").length)
  const mcpError = createMemo(() => Object.values(sync.data.mcp).some((x) => x.status === "failed"))
  const lsp = createMemo(() => Object.keys(sync.data.lsp))
  const permissions = createMemo(() => {
    if (route.data.type !== "session") return []
    return sync.data.permission[route.data.sessionID] ?? []
  })
  const directory = useDirectory()
  const connected = useConnected()
  const agentName = createMemo(() => local.agent.current()?.name)
  const agentColor = createMemo(() => local.agent.color(agentName() ?? ""))
  const modelName = createMemo(() => {
    const m = local.model.current()
    if (!m) return undefined
    return Model.name(sync.data.provider, m.providerID, m.modelID)
  })
  const sessionStatus = createMemo(() => {
    if (route.data.type !== "session") return undefined
    return sync.data.session_status[route.data.sessionID]
  })

  const [store, setStore] = createStore({
    welcome: false,
  })

  onMount(() => {
    const timeouts: ReturnType<typeof setTimeout>[] = []

    function tick() {
      if (connected()) return
      if (!store.welcome) {
        setStore("welcome", true)
        timeouts.push(setTimeout(() => tick(), 5000))
        return
      }

      if (store.welcome) {
        setStore("welcome", false)
        timeouts.push(setTimeout(() => tick(), 10_000))
        return
      }
    }
    timeouts.push(setTimeout(() => tick(), 10_000))

    onCleanup(() => {
      timeouts.forEach(clearTimeout)
    })
  })

  return (
    <box flexDirection="row" justifyContent="space-between" gap={1} flexShrink={0}>
      <box flexDirection="row" gap={2} flexShrink={0}>
        <text fg={theme.textMuted}>{directory()}</text>
        <Show when={agentName()}>
          <text fg={theme.textMuted}>
            <span style={{ fg: agentColor() }}>▣</span> {agentName()}
          </text>
        </Show>
        <Show when={modelName()}>
          <text fg={theme.textMuted}>⌬ {modelName()}</text>
        </Show>
        <Show when={thinking.mode() === "show"}>
          <text fg={theme.warning}>◈ think</text>
        </Show>
      </box>
      <box gap={2} flexDirection="row" flexShrink={0}>
        <Switch>
          <Match when={store.welcome}>
            <text fg={theme.text}>
              Get started <span style={{ fg: theme.textMuted }}>/connect</span>
            </text>
          </Match>
          <Match when={connected()}>
            <Show when={permissions().length > 0}>
              <text fg={theme.warning}>
                △ {permissions().length}
              </text>
            </Show>
            <Show when={sessionStatus()?.type === "busy"}>
              <text fg={theme.warning}>◔ working</text>
            </Show>
            <Show when={sessionStatus()?.type === "retry"}>
              <text fg={theme.error}>⊙ retrying</text>
            </Show>
            <text fg={theme.text}>
              <span style={{ fg: lsp().length > 0 ? theme.success : theme.textMuted }}>●</span> {lsp().length} LSP
            </text>
            <Show when={mcp()}>
              <text fg={theme.text}>
                <Switch>
                  <Match when={mcpError()}>
                    <span style={{ fg: theme.error }}>● </span>
                  </Match>
                  <Match when={true}>
                    <span style={{ fg: theme.success }}>● </span>
                  </Match>
                </Switch>
                {mcp()} MCP
              </text>
            </Show>
            <text fg={theme.textMuted}>/status</text>
          </Match>
        </Switch>
      </box>
    </box>
  )
}
