import { createMemo, Match, onCleanup, onMount, Show, Switch } from "solid-js"
import { useTheme } from "../../context/theme"
import { useSync } from "../../context/sync"
import { useDirectory } from "../../context/directory"
import { useConnected } from "../../component/use-connected"
import { AnimatedIcon, Label } from "../../ui/icon"
import { createStore } from "solid-js/store"
import { space, chromeGutter } from "../../design-tokens"
import { useRoute } from "../../context/route"
import { useLocal } from "../../context/local"
import { useThinkingMode } from "../../context/thinking"
import * as Model from "../../util/model"

export function Footer() {
  const { theme } = useTheme()
  const sync = useSync()
  const route = useRoute()
  const mcp = createMemo(() => Object.values(sync.data.mcp).filter((x) => x.status === "connected").length)
  const mcpError = createMemo(() => Object.values(sync.data.mcp).some((x) => x.status === "failed"))
  const lsp = createMemo(() => Object.keys(sync.data.lsp))
  const permissions = createMemo(() => {
    if (route.data.type !== "session") return []
    return sync.data.permission[route.data.sessionID] ?? []
  })
  const directory = useDirectory()
  const connected = useConnected()
  const local = useLocal()
  const thinking = useThinkingMode()
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
    // Track all timeouts to ensure proper cleanup
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
    <box flexDirection="row" justifyContent="space-between" gap={1} flexShrink={0} paddingTop={space.xs} paddingBottom={space.xs} paddingLeft={chromeGutter} paddingRight={chromeGutter} borderColor={theme.borderSubtle} border={["top"]}>
      <box flexDirection="row" gap={2} flexShrink={0}>
        <text fg={theme.textMuted}>{directory()}</text>
        <Show when={agentName()}>
          <box flexDirection="row" gap={1} alignItems="center">
            <Label icon="agent" fg={agentColor()} />
            <text fg={theme.textMuted}>{agentName()}</text>
          </box>
        </Show>
        <Show when={modelName()}>
          <box flexDirection="row" gap={1} alignItems="center">
            <Label icon="model" fg={theme.textMuted} />
            <text fg={theme.textMuted}>{modelName()}</text>
          </box>
        </Show>
        <Show when={thinking.mode() === "show"}>
          <box flexDirection="row" gap={1} alignItems="center">
            <Label icon="thinking" fg={theme.warning} />
            <text fg={theme.warning}>think</text>
          </box>
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
              <box flexDirection="row" gap={1} alignItems="center">
                <AnimatedIcon icon="warn" fg={theme.warning} />
                <text fg={theme.warning}>
                  {permissions().length} Permission{permissions().length > 1 ? "s" : ""}
                </text>
              </box>
            </Show>
            <Show when={sessionStatus()?.type === "busy"}>
              <AnimatedIcon icon="busy" fg={theme.warning} />
            </Show>
            <Show when={sessionStatus()?.type === "retry"}>
              <AnimatedIcon icon="retry" fg={theme.error} />
            </Show>
            <box flexDirection="row" gap={1} alignItems="center">
              <AnimatedIcon icon="idle" fg={lsp().length > 0 ? theme.success : theme.textMuted} />
              <text fg={theme.text}>{lsp().length} LSP</text>
            </box>
            <Show when={mcp()}>
              <box flexDirection="row" gap={1} alignItems="center">
                <Switch>
                  <Match when={mcpError()}>
                    <AnimatedIcon icon="retry" fg={theme.error} />
                  </Match>
                  <Match when={true}>
                    <AnimatedIcon icon="idle" fg={theme.success} />
                  </Match>
                </Switch>
                <text fg={theme.text}>{mcp()} MCP</text>
              </box>
            </Show>
            <text fg={theme.textMuted}>/status</text>
          </Match>
          <Match when={true}>
            <text fg={theme.textMuted}>Connecting…</text>
          </Match>
        </Switch>
      </box>
    </box>
  )
}
