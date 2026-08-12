import { createMemo, For, Show } from "solid-js"
import { space } from "../../design-tokens"
import { useTheme } from "../../context/theme"
import { GLYPH } from "../../ui/glyphs"

export interface VerifyReportItem {
  readonly verifier: string
  readonly status: "passed" | "failed" | "skipped"
  readonly detail?: string
  readonly failures?: number
}

export function isVerifyReport(text: string): boolean {
  return text.trimStart().startsWith("[auto-verify]")
}

/**
 * Parses the durable synthetic message text published by the runner's M9
 * auto-verify step. Format (from `Trigger.renderReports`):
 *   `[auto-verify] typecheck: passed; lint: FAILED — src/App.ts: Cannot find name 'x' (2 failures); test: skipped (not runnable here, exit 1)`
 */
export function parseVerifyReport(text: string): VerifyReportItem[] {
  const trimmed = text.trim()
  if (!isVerifyReport(trimmed)) return []
  const body = trimmed.replace(/^\[auto-verify\]\s*/, "")
  if (!body) return []
  return body.split("; ").flatMap((segment): VerifyReportItem[] => {
    const colon = segment.indexOf(": ")
    if (colon === -1) return []
    const verifier = segment.slice(0, colon)
    const rest = segment.slice(colon + 2)

    if (rest === "passed") return [{ verifier, status: "passed" }]

    if (rest.startsWith("FAILED")) {
      const inner = rest.startsWith("FAILED — ") ? rest.slice("FAILED — ".length) : rest.slice("FAILED".length)
      const openParen = inner.lastIndexOf(" (")
      let detail = inner
      let failures: number | undefined
      if (openParen !== -1) {
        const failuresMatch = /^\((\d+) failures\)$/.exec(inner.slice(openParen + 1))
        if (failuresMatch) {
          detail = inner.slice(0, openParen)
          failures = Number(failuresMatch[1])
        }
      }
      return [{ verifier, status: "failed", detail: detail || undefined, failures }]
    }

    if (rest.startsWith("skipped")) {
      const body = rest.slice("skipped".length)
      const line = body.startsWith(" (") && body.endsWith(")") ? body.slice(2, body.length - 1) : body.trim()
      return [{ verifier, status: "skipped", detail: line || undefined }]
    }

    return [{ verifier, status: "skipped", detail: rest }]
  })
}

export function VerifyReportView(props: { text: string }) {
  const { theme } = useTheme()
  const items = createMemo(() => parseVerifyReport(props.text))

  return (
    <box
      marginTop={space.sm}
      marginLeft={1}
      flexDirection="column"
      borderStyle="rounded"
      borderColor={theme.borderSubtle}
      backgroundColor={theme.backgroundElement}
      paddingX={1}
      paddingY={space.xs}
    >
      <For each={items()}>
        {(item) => (
          <box flexDirection="row">
            <text fg={item.status === "passed" ? theme.success : item.status === "failed" ? theme.error : theme.textMuted}>
              {item.status === "passed" ? GLYPH.check : item.status === "failed" ? GLYPH.cross : GLYPH.mcp.disabled}
            </text>
            <text fg={theme.text}> {item.verifier}</text>
            <Show when={item.detail}>
              <text fg={theme.textMuted}> {item.detail}</text>
            </Show>
            <Show when={item.failures !== undefined}>
              <text fg={theme.textMuted}> ({item.failures} failures)</text>
            </Show>
          </box>
        )}
      </For>
    </box>
  )
}