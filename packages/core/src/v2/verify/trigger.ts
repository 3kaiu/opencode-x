// V2 verification auto-trigger (M9 §9.6 L1): write events → matching
// verifiers run in parallel → semanticized results. The orchestrator injects
// the rendered reports into the next turn's history so the model sees
// verification feedback without being asked to run it.
export * as Trigger from "./trigger"

import { Effect } from "effect"
import { Verify, type Verifier } from "./verifier"
import { RunTools } from "../tools/run-tools"

export interface VerifyReport {
  readonly verifier: string
  readonly passed: boolean
  readonly failures: ReadonlyArray<Verify.Failure>
  readonly output: string
  readonly exitCode: number
}

/** Verifiers whose trigger globs match any written path. */
export function matchingVerifiers(
  verifiers: ReadonlyArray<Verifier>,
  writtenPaths: ReadonlyArray<string>,
): ReadonlyArray<Verifier> {
  if (writtenPaths.length === 0) return []
  return verifiers.filter((v) =>
    v.triggers.some((t) => writtenPaths.some((p) => new Bun.Glob(t.glob).match(p))),
  )
}

/** Runs verifiers in parallel; every failure is reported, never thrown. */
export const runVerifiers = Effect.fn("V2Verify.runVerifiers")(function* (
  workspace: string,
  verifiers: ReadonlyArray<Verifier>,
  timeoutMs = 30_000,
) {
  if (verifiers.length === 0) return [] as ReadonlyArray<VerifyReport>
  return yield* Effect.forEach(
    verifiers,
    (v) =>
      Effect.gen(function* () {
        const output = yield* RunTools.run(workspace, [v.command, ...v.args].join(" "), timeoutMs)
        const failures = v.parse(output)
        const exitCode = Number(/^exit (\d+)/.exec(output)?.[1] ?? -1)
        return { verifier: v.id, passed: failures.length === 0, failures, output, exitCode } satisfies VerifyReport
      }),
    { concurrency: verifiers.length },
  )
})

/** Renders reports into compact history lines for the next turn. */
export function renderReports(reports: ReadonlyArray<VerifyReport>): ReadonlyArray<string> {
  return reports.map((r) => {
    if (r.passed) return `${r.verifier}: passed`
    if (r.failures.length > 0) {
      const first = r.failures[0]
      const detail = first ? `${first.file || "?"}: ${first.message}` : "failed"
      const count = r.failures.length > 1 ? ` (${r.failures.length} failures)` : ""
      return `${r.verifier}: FAILED — ${detail}${count}`
    }
    // Non-zero exit with no parseable failures: verifier unavailable in this workspace.
    return `${r.verifier}: skipped (not runnable here, exit ${r.exitCode})`
  })
}
