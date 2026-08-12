import { Show } from "solid-js"
import { space } from "../../design-tokens"
import { useTheme } from "../../context/theme"
import { useLocal } from "../../context/local"
import { useLocale } from "../../context/locale"
import { Locale } from "../../util/locale"
import type { SessionInfo } from "@opencode-ai/sdk/v2"
import { GLYPH } from "../../ui/glyphs"

export function PlanBanner() {
  const { theme } = useTheme()
  const local = useLocal()
  const locale = useLocale()
  const active = () => local.agent.current()?.id === "plan"

  return (
    <Show when={active()}>
      <box
        flexDirection="row"
        marginLeft={1}
        marginRight={1}
        marginBottom={space.sm}
        paddingLeft={1}
        paddingRight={1}
        borderStyle="rounded"
        borderColor={theme.warning}
        backgroundColor={theme.backgroundElement}
      >
        <text fg={theme.warning}>{GLYPH.warning}</text>
        <text fg={theme.warning}> {locale.t("plan.banner")}</text>
      </box>
    </Show>
  )
}

function tokenCount(value: number | undefined): string {
  if (value === undefined || value <= 0) return ""
  return `${Locale.number(value)} tok`
}

export function SessionCost(props: { session: SessionInfo | undefined }) {
  const { theme } = useTheme()
  const locale = useLocale()
  const cost = () => props.session?.cost ?? 0
  const tokens = () => props.session?.tokens ?? undefined

  return (
    <Show when={cost() > 0 || (tokens()?.input ?? 0) > 0}>
      <box flexDirection="row" marginLeft={1} marginRight={1} marginTop={space.xs}>
        <Show when={cost() > 0}>
          <text fg={theme.textMuted}>{Locale.money(cost())}</text>
        </Show>
        <Show when={tokens() && (tokens()?.input ?? 0) > 0}>
          <text fg={theme.textMuted}>
            {cost() > 0 ? "  " : ""}
            {locale.t("tokens.in")} {tokenCount(tokens()?.input)} · {locale.t("tokens.out")}{" "}
            {tokenCount(tokens()?.output)} · {locale.t("tokens.cache")} {tokenCount(tokens()?.cache.read)}
          </text>
        </Show>
      </box>
    </Show>
  )
}