import { createMemo, Show, type JSX } from "solid-js"
import { useSync } from "../../context/sync"
import { useLocal } from "../../context/local"
import { useTheme } from "../../context/theme"
import { useRouteData } from "../../context/route"
import * as Model from "../../util/model"
import { space } from "../../design-tokens"
import { PixelIcon } from "../../component/icon-renderable"
import { statusInfo } from "../../ui/icon"
import type { AssistantMessage } from "@opencode-ai/sdk/v2"

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" })

type SessionStatusType = "idle" | "busy" | "retry" | "error"

export function SessionStatusBar(props: { children?: JSX.Element }) {
  const route = useRouteData("session")
  const sync = useSync()
  const local = useLocal()
  const { theme } = useTheme()

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

  const si = createMemo(() => statusInfo(theme, status() as any))

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

  return (
    <box
      flexDirection="row"
      gap={space.sm}
      paddingLeft={space.sm}
      paddingRight={space.sm}
      paddingBottom={space.xs}
      flexShrink={0}
      alignItems="center"
    >
      <PixelIcon icon={si().icon} fg={si().color} />
      <Show when={agentName()}>
        <text fg={agentColor()}>
          <b>{agentName()}</b>
        </text>
      </Show>
      <Show when={modelName()}>
        <text fg={theme.textMuted}>{modelName()}</text>
      </Show>
      <Show when={context().tokens > 0}>
        <text fg={theme.textSubtle ?? theme.textMuted}>
          {context().tokens.toLocaleString()} tokens
          <Show when={context().percent !== null}>
            <span style={{ fg: context().percent! > 80 ? theme.warning : theme.textSubtle }}>
              {" "}{context().percent}%
            </span>
          </Show>
        </text>
      </Show>
      <Show when={cost() > 0}>
        <text fg={theme.textSubtle ?? theme.textMuted}>{money.format(cost())}</text>
      </Show>
      <box flexGrow={1} />
      {props.children}
    </box>
  )
}
