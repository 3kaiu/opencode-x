import { createMemo, Show, type JSX } from "solid-js"
import { useSync } from "../../context/sync"
import { useLocal } from "../../context/local"
import { useTheme } from "../../context/theme"
import { useRouteData } from "../../context/route"
import { useThinkingMode } from "../../context/thinking"
import { useDirectory } from "../../context/directory"
import * as Model from "../../util/model"
import { space, chromeGutter } from "../../design-tokens"
import { PixelIcon } from "../../component/icon-renderable"
import { Spinner } from "../../component/spinner"
import { statusInfo, Label } from "../../ui/icon"
import { useKV } from "../../context/kv"
import type { AssistantMessage } from "@opencode-ai/sdk/v2"

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" })

export function SessionStatusBar(props: { children?: JSX.Element }) {
  const route = useRouteData("session")
  const sync = useSync()
  const local = useLocal()
  const { theme } = useTheme()
  const thinking = useThinkingMode()
  const directory = useDirectory()
  const kv = useKV()

  const session = createMemo(() => sync.session.get(route.sessionID))
  const status = createMemo(() => sync.data.session_status[route.sessionID])
  const messages = createMemo(() => sync.data.message[route.sessionID] ?? [])

  const agentName = createMemo(() => local.agent.current()?.name)
  const agentColor = createMemo(() => local.agent.color(agentName() ?? ""))

  const modelName = createMemo(() => {
    const m = local.model.current()
    if (!m) return undefined
    return Model.name(sync.data.provider, m.providerID, m.modelID)
  })

  const si = createMemo(() => statusInfo(theme, status()))

  const context = createMemo(() => {
    const last = messages().findLast(
      (item): item is AssistantMessage => item.role === "assistant" && item.tokens.output > 0,
    )
    if (!last) return { tokens: 0, percent: null }
    const tokens =
      last.tokens.input + last.tokens.output + last.tokens.reasoning + last.tokens.cache.read + last.tokens.cache.write
    const model = sync.data.provider.find((item) => item.id === last.providerID)?.models[last.modelID]
    return {
      tokens,
      percent: model?.limit.context ? Math.round((tokens / model.limit.context) * 100) : null,
    }
  })

  const cost = createMemo(() => session()?.cost ?? 0)

  const modeLabel = createMemo(() => {
    const m = local.model.variant.current()
    if (m) return `[${m}]`
    return ""
  })

  const statusLabel = createMemo(() => {
    const s = status()
    if (!s) return ""
    if (s.type === "busy") {
      const lastAssistant = messages().findLast((m) => m.role === "assistant")
      const parts = lastAssistant ? sync.data.part[lastAssistant.id] ?? [] : []
      const runningTool = parts.findLast((p) => p.type === "tool" && p.state.status === "running")
      if (runningTool?.type === "tool") return `Running ${runningTool.tool}…`
      return "Thinking…"
    }
    if (s.type === "retry") return "Retrying…"
    return ""
  })

  const animationsEnabled = createMemo(() => kv.get("animations_enabled", true))

  return (
    <box flexShrink={0} paddingLeft={chromeGutter} paddingRight={chromeGutter} border={["top"]} borderColor={theme.borderSubtle}>
      {/* Line 1: pulse indicator + status dot + agent name + model + mode badge */}
      <box
        flexDirection="row"
        gap={space.sm}
        paddingBottom={space.xs}
        alignItems="center"
        paddingTop={space.xs}
      >
        <Show when={animationsEnabled() && (status()?.type === "busy" || status()?.type === "retry")}>
          <Spinner color={si().color} />
        </Show>
        <PixelIcon icon={si().icon} fg={si().color} />
        <Show when={agentName()}>
          <text fg={agentColor()}>
            <b>{agentName()}</b>
          </text>
        </Show>
        <Show when={modelName()}>
          <text fg={theme.textMuted}>{modelName()}</text>
        </Show>
        <Show when={thinking.mode() === "show"}>
          <box flexDirection="row" gap={1} alignItems="center">
            <Label icon="thinking" fg={theme.warning} />
            <text fg={theme.warning}>think</text>
          </box>
        </Show>
        <Show when={modeLabel()}>
          <text fg={theme.warning}>
            <b>{modeLabel()}</b>
          </text>
        </Show>
        <Show when={statusLabel()}>
          <text fg={theme.textMuted}>{statusLabel()}</text>
        </Show>
        <Show when={directory()}>
          <text fg={theme.textMuted}>{directory()}</text>
        </Show>
        <Show when={props.children}>
          <box gap={space.xs} flexDirection="row">{props.children}</box>
        </Show>
        <box flexGrow={1} />
        <Show when={context().tokens > 0}>
          <text fg={theme.textSubtle ?? theme.textMuted}>
            {context().tokens.toLocaleString()} tokens
            <Show when={context().percent !== null}>
              <span style={{ fg: context().percent! > 80 ? theme.warning : theme.textSubtle ?? theme.textMuted }}>
                {" "}({context().percent}%)
              </span>
            </Show>
          </text>
        </Show>
        <Show when={cost() > 0}>
          <text fg={theme.textSubtle ?? theme.textMuted}>{money.format(cost())}</text>
        </Show>
      </box>
    </box>
  )
}
