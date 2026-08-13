import type { SessionStatus } from "@opencode-ai/sdk/v2"
import { isVerifyReport } from "./verify"

// synthetic messages carry engine-generated text (e.g. auto-verify reports)
export function verifyReportText(message: Record<string, unknown> | undefined): string | undefined {
  if (message?.type !== "synthetic") return undefined
  const text = message.text
  return typeof text === "string" && isVerifyReport(text) ? text : undefined
}

const GO_UPSELL_FREE_TIER_LAST_SEEN_AT = "go_upsell_last_seen_at"
const GO_UPSELL_FREE_TIER_DONT_SHOW = "go_upsell_dont_show"
const GO_UPSELL_ACCOUNT_RATE_LIMIT_LAST_SEEN_AT = "go_upsell_account_rate_limit_last_seen_at"
const GO_UPSELL_ACCOUNT_RATE_LIMIT_DONT_SHOW = "go_upsell_account_rate_limit_dont_show"
export const GO_UPSELL_WINDOW = 86_400_000 // 24 hrs
const GO_UPSELL_PROVIDERS = new Set(["opencode", "opencode-go"])

export type RetryAction = Extract<SessionStatus, { type: "retry" }>["action"]

export function goUpsellKeys(action: RetryAction) {
  if (!action) return
  if (!GO_UPSELL_PROVIDERS.has(action.provider)) return
  if (action.reason === "free_tier_limit") {
    return {
      lastSeenAt: GO_UPSELL_FREE_TIER_LAST_SEEN_AT,
      dontShow: GO_UPSELL_FREE_TIER_DONT_SHOW,
    }
  }
  if (action.reason === "account_rate_limit") {
    return {
      lastSeenAt: GO_UPSELL_ACCOUNT_RATE_LIMIT_LAST_SEEN_AT,
      dontShow: GO_UPSELL_ACCOUNT_RATE_LIMIT_DONT_SHOW,
    }
  }
}

export const sessionBindingCommands = [
  "session.rename",
  "session.timeline",
  "session.fork",
  "session.compact",
  "session.undo",
  "session.redo",
  "session.toggle.conceal",
  "session.toggle.timestamps",
  "session.toggle.thinking",
  "session.toggle.actions",
  "session.toggle.scrollbar",
  "session.toggle.generic_tool_output",
  "session.messages_last_user",
  "session.message.next",
  "session.message.previous",
  "messages.copy",
  "session.copy",
  "session.export",
] as const

export const sessionGlobalBindingCommands = [
  "session.page.up",
  "session.page.down",
  "session.line.up",
  "session.line.down",
  "session.half.page.up",
  "session.half.page.down",
] as const

// Viewport navigation keys (home/end, arrow keys for parent/child sessions)
// must not shadow the prompt textarea's own editing keys (cursor home/end,
// arrow movement). The keymap resolves global layers before target-scoped
// input layers, so ungated bindings would win while typing — e.g. `home`
// would jump to the first message instead of moving the cursor to line
// start. Gate them on "no focused editor", like the original first/last.
export const sessionGlobalUnfocusedBindingCommands = [
  "session.first",
  "session.last",
  "session.child.first",
  "session.parent",
  "session.child.next",
  "session.child.previous",
] as const