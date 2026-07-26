import { createMemo, createSignal, Show } from "solid-js"
import { useRouteData } from "../../context/route"
import { useSync } from "../../context/sync"
import { useTheme } from "../../context/theme"
import { space } from "../../design-tokens"
import type { AssistantMessage } from "@opencode-ai/sdk/v2"
import { Locale } from "../../util/locale"
import { useCommandShortcut, useOpencodeKeymap } from "../../keymap"
import { PixelIcon } from "../../component/icon-renderable"
import { statusInfo } from "../../ui/icon"

export function SubagentFooter() {
  const route = useRouteData("session")
  const sync = useSync()
  const messages = createMemo(() => sync.data.message[route.sessionID] ?? [])
  const session = createMemo(() => sync.session.get(route.sessionID))

  const subagentInfo = createMemo(() => {
    const s = session()
    if (!s) return { label: "Subagent", index: 0, total: 0 }
    const agentMatch = s.title.match(/@(\w+) subagent/)
    const label = agentMatch ? Locale.titlecase(agentMatch[1]) : "Subagent"

    if (!s.parentID) return { label, index: 0, total: 0 }

    const siblings = sync.data.session
      .filter((x) => x.parentID === s.parentID)
      .toSorted((a, b) => a.time.created - b.time.created)
    const index = siblings.findIndex((x) => x.id === s.id)

    return { label, index: index + 1, total: siblings.length }
  })

  const usage = createMemo(() => {
    const msg = messages()
    const last = msg.findLast((item): item is AssistantMessage => item.role === "assistant" && item.tokens.output > 0)
    if (!last) return

    const tokens =
      last.tokens.input + last.tokens.output + last.tokens.reasoning + last.tokens.cache.read + last.tokens.cache.write
    if (tokens <= 0) return

    const model = sync.data.provider.find((item) => item.id === last.providerID)?.models[last.modelID]
    const pct = model?.limit.context ? Math.round((tokens / model.limit.context) * 100) : undefined
    const cost = session()?.cost ?? 0

    return {
      context: pct !== undefined ? `${Locale.number(tokens)} (${pct}%)` : Locale.number(tokens),
      percent: pct,
      cost: cost > 0 ? Locale.money(cost) : undefined,
    }
  })

  const { theme } = useTheme()

  // Warn as the context window fills up: >80% is urgent, >60% is caution.
  const usageColor = createMemo(() => {
    const pct = usage()?.percent
    if (pct === undefined) return theme.textMuted
    if (pct > 80) return theme.error
    if (pct > 60) return theme.warning
    return theme.textMuted
  })

  const keymap = useOpencodeKeymap()
  const parentShortcut = useCommandShortcut("session.parent")
  const previousShortcut = useCommandShortcut("session.child.previous")
  const nextShortcut = useCommandShortcut("session.child.next")
  const [hover, setHover] = createSignal<"parent" | "prev" | "next" | null>(null)

  const status = createMemo(() => sync.data.session_status[route.sessionID])

  const statusDot = createMemo(() => statusInfo(theme, status()))
  return (
    <box flexShrink={0}>
      <box
        paddingTop={space.xs}
        paddingBottom={space.xs}
        paddingLeft={space.sm}
        paddingRight={space.xs}
        border={["top"]}
        borderColor={theme.borderSubtle}
        flexShrink={0}
      >
        <box flexDirection="row" justifyContent="space-between" gap={1}>
          <box flexDirection="row" gap={1}>
            <PixelIcon icon={statusDot().icon} fg={statusDot().color} />
            <text fg={theme.text}>
              <b>{subagentInfo().label}</b>
            </text>
            <Show when={subagentInfo().total > 0}>
              <text style={{ fg: theme.textMuted }}>
                ({subagentInfo().index} of {subagentInfo().total})
              </text>
            </Show>
            <Show when={usage()}>
              {(item) => (
                <text fg={usageColor()} wrapMode="none">
                  {item().context}
                  <Show when={item().cost}>
                    <span style={{ fg: theme.textMuted }}> · {item().cost}</span>
                  </Show>
                </text>
              )}
            </Show>
          </box>
          <box flexDirection="row" gap={2}>
            <box
              onMouseOver={() => setHover("parent")}
              onMouseOut={() => setHover(null)}
              onMouseUp={() => keymap.dispatchCommand("session.parent")}
              paddingLeft={1} paddingRight={1}
              backgroundColor={hover() === "parent" ? theme.backgroundElement : theme.backgroundPanel}
            >
              <box flexDirection="row" gap={1}>
                <PixelIcon icon="arrow_up" fg={theme.text} bg={hover() === "parent" ? theme.backgroundElement : theme.backgroundPanel} />
                <text fg={theme.text}>
                  Parent <span style={{ fg: theme.textMuted }}>{parentShortcut()}</span>
                </text>
              </box>
            </box>
            <box
              onMouseOver={() => setHover("prev")}
              onMouseOut={() => setHover(null)}
              onMouseUp={() => keymap.dispatchCommand("session.child.previous")}
              paddingLeft={1} paddingRight={1}
              backgroundColor={hover() === "prev" ? theme.backgroundElement : theme.backgroundPanel}
            >
              <box flexDirection="row" gap={1}>
                <PixelIcon icon="arrow_left" fg={theme.text} bg={hover() === "prev" ? theme.backgroundElement : theme.backgroundPanel} />
                <text fg={theme.text}>
                  Prev <span style={{ fg: theme.textMuted }}>{previousShortcut()}</span>
                </text>
              </box>
            </box>
            <box
              onMouseOver={() => setHover("next")}
              onMouseOut={() => setHover(null)}
              onMouseUp={() => keymap.dispatchCommand("session.child.next")}
              paddingLeft={1} paddingRight={1}
              backgroundColor={hover() === "next" ? theme.backgroundElement : theme.backgroundPanel}
            >
              <box flexDirection="row" gap={1}>
                <text fg={theme.text}>
                  Next <span style={{ fg: theme.textMuted }}>{nextShortcut()}</span>
                </text>
                <PixelIcon icon="arrow_right" fg={theme.text} bg={hover() === "next" ? theme.backgroundElement : theme.backgroundPanel} />
              </box>
            </box>
          </box>
        </box>
      </box>
    </box>
  )
}
