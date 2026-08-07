import { createEffect, batch } from "solid-js"
import { reconcile, produce } from "solid-js/store"
import { useSync, toV1Session } from "./sync"
import { useData } from "./data"
import { useRoute } from "./route"
import { convertV2Messages } from "./v2-convert"
import { debugLog } from "../util/debug"

/**
 * V2Bridge: watches the V2 DataProvider store and projects V2 SessionMessage[]
 * into the V1 SyncProvider store (Message.Info[] + Part[]) that all rendering code reads.
 *
 * This is the core bridge that makes the TUI work when prompts go through V2.
 * Without it, V2 events update the DataProvider store but the rendering code
 * (which reads from SyncProvider) never sees the updates.
 */
export function V2Bridge() {
  const sync = useSync()
  const data = useData()
  const route = useRoute()

  // When the active session changes, ensure V2 info is loaded into the DataProvider store.
  // Message history is reconstructed from the session-scoped cursor replay in data.tsx
  // (the authoritative source for the active session); a separate snapshot fetch here
  // would double-apply historical deltas on top of the replay.
  createEffect(() => {
    const r = route.data
    if (r.type !== "session") return
    void data.session.refresh(r.sessionID)
  })

  // React to V2 message changes and bridge to V1 sync store.
  createEffect(() => {
    const r = route.data
    if (r.type !== "session") return
    const sessionID = r.sessionID
    const start = performance.now()
    const v2Messages = data.session.message.list(sessionID)
    debugLog("[v2bridge] messages", sessionID, "count:", v2Messages?.length ?? 0, "last:", (v2Messages as { type?: string }[] | undefined)?.at(-1)?.type)
    if (!v2Messages || v2Messages.length === 0) return
    const sessionInfo = data.session.get(sessionID)
    const { messages, parts, status } = convertV2Messages(sessionID, v2Messages, sessionInfo)
    const convertedMs = performance.now() - start
    const reconcileStart = performance.now()
    batch(() => {
      sync.set("message", sessionID, reconcile(messages))
      for (const messageID in parts) {
        sync.set("part", messageID, reconcile(parts[messageID]))
      }
      sync.set("session_status", sessionID, reconcile(status))
    })
    const totalMs = performance.now() - start
    debugLog(
      "[v2bridge] project",
      sessionID,
      "messages:",
      messages.length,
      "parts:",
      Object.keys(parts).length,
      "status:",
      status,
      `convert:${convertedMs.toFixed(1)}ms`,
      `total:${totalMs.toFixed(1)}ms`,
    )
  })

  // Watch for V2 session info changes and bridge to V1 sync store.
  // The V2 runner auto-titles sessions via bare DB writes without publishing session.updated,
  // so we poll the DataProvider's session info to catch those changes.
  // Explicit update() calls do publish session.updated, which the sync event handler covers;
  // this effect serves as a fallback for runner-initiated mutations.
  createEffect(() => {
    const r = route.data
    if (r.type !== "session") return
    const sessionID = r.sessionID
    const v2Info = data.session.get(sessionID)
    if (!v2Info) return
    const v1Session = toV1Session(v2Info)
    sync.set(
      "session",
      produce((draft) => {
        const idx = draft.findIndex((s) => s.id === sessionID)
        if (idx >= 0) draft[idx] = v1Session
        else draft.push(v1Session)
      }),
    )
  })

  return null
}
