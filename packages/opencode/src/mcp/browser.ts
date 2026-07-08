import { McpEvent } from "@opencode-ai/schema/mcp-event"
import { EventV2Bridge } from "@/event-v2-bridge"
import open from "open"
import { Effect } from "effect"

export namespace McpBrowser {
  /**
   * Open a URL in the default browser.
   * Returns an Effect that never fails — on failure it emits a BrowserOpenFailed event.
   */
  export const openUrl = (
    mcpName: string,
    url: string,
    events: EventV2Bridge.Shape,
  ): Effect.Effect<void> =>
    Effect.tryPromise(() => open(url)).pipe(
      Effect.flatMap((subprocess) =>
        Effect.callback<void, Error>((resume) => {
          const timer = setTimeout(() => resume(Effect.void), 500)
          subprocess.on("error", (err) => {
            clearTimeout(timer)
            resume(Effect.fail(err))
          })
          subprocess.on("exit", (code) => {
            if (code !== null && code !== 0) {
              clearTimeout(timer)
              resume(Effect.fail(new Error(`Browser open failed with exit code ${code}`)))
            }
          })
        }),
      ),
      Effect.catchAll(() =>
        events.publish(McpEvent.BrowserOpenFailed, { mcpName, url }).pipe(Effect.ignore),
      ),
    )
}
