// V2 runner lesson sedimentation (M5 §5.6): failed auto-verifications become
// pending lessons in the V2 memory wire, localized by the configured locale.
export * as RunnerSediment from "./sediment"

import type { MemoryStore } from "../../memory/store"
import { Sediment } from "../../memory/sediment"
import type { Trigger } from "../../verify/trigger"
import type { SessionSchema } from "../schema"

/** Failed verifications become pending lessons; only assertion/timeout failures map to known categories. */
export async function sedimentVerificationFailures(
  store: MemoryStore,
  reports: ReadonlyArray<Trigger.VerifyReport>,
  sessionID: SessionSchema.ID,
  locale?: "en" | "zh",
): Promise<void> {
  for (const report of reports) {
    if (report.passed || report.failures.length === 0) continue
    const failure = report.failures[0]
    const category = failure.category === "assert" ? "Assertion" : failure.category === "timeout" ? "Timeout" : undefined
    if (!category) continue
    await Sediment.recordPending(
      store,
      {
        kind: "tool.failed",
        tool: report.verifier,
        error: failure.message.slice(0, 200),
        category,
        sessionID,
        at: Date.now(),
      },
      locale,
    )
  }
}
