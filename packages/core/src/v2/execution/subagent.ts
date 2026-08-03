// V2 execution — subagent protocol (M4 §4.6).
// Parent sees ONLY the child's final summary (shortest-summary floor with one
// continuation attempt); resume semantics for crash/timeout recovery.
// Design source: kimi-code subagent-host (SUMMARY_MIN_LENGTH=200, resume).
export * as Subagent from "./subagent"

import { Effect } from "effect"

export const SUMMARY_MIN_LENGTH = 200
export const SUMMARY_CONTINUATION_ATTEMPTS = 1

export type SubagentProfile = "coder" | "explore" | "plan" | "custom"

export interface DelegateRequest {
  readonly task: string
  readonly profile: SubagentProfile
  readonly constraints?: {
    readonly readonly?: boolean
    readonly allowedPaths?: ReadonlyArray<string>
    readonly deniedPaths?: ReadonlyArray<string>
  }
  readonly model?: string
  readonly budget?: { readonly maxTokens?: number; readonly maxDurationMs?: number }
  readonly parentSessionID?: string
}

export interface SubagentResult {
  readonly summary: string
  readonly decisions?: ReadonlyArray<string>
  readonly artifacts?: ReadonlyArray<{ readonly path: string; readonly note: string }>
  readonly openQuestions?: ReadonlyArray<string>
  readonly spent?: { readonly tokens: number; readonly cost: number }
  readonly resumeID?: string
  readonly status: "completed" | "timeout" | "failed" | "interrupted"
  readonly failure?: { readonly reason: string; readonly attempted: ReadonlyArray<string>; readonly suggestion?: string }
}

export interface SubagentRunner {
  readonly run: (request: DelegateRequest) => Effect.Effect<SubagentResult, unknown>
}

/**
 * Guards the parent-facing summary: if the child's last message is too short
 * to be useful, inject a continuation prompt and re-run once.
 */
export function ensureSummaryFloor(
  initial: SubagentResult,
  rerun: (prompt: string) => Effect.Effect<SubagentResult, unknown>,
  minLength = SUMMARY_MIN_LENGTH,
  attempts = SUMMARY_CONTINUATION_ATTEMPTS,
): Effect.Effect<SubagentResult, unknown> {
  return Effect.gen(function* () {
    let result = initial
    let remaining = attempts
    while (remaining > 0 && result.status === "completed" && result.summary.length < minLength) {
      const continuation = `Your previous response was too brief (${result.summary.length} chars < ${minLength}). Please summarize the key conclusions, decisions, artifacts and any open questions from your work.`
      result = yield* rerun(continuation)
      remaining -= 1
    }
    return result
  })
}

/** Wraps a runner with the summary floor. */
export function withSummaryFloor(
  runner: SubagentRunner,
  rerunPrompt: (previous: SubagentResult) => string = defaultRerunPrompt,
): SubagentRunner {
  return {
    run: (request) =>
      Effect.gen(function* () {
        let result = yield* runner.run(request)
        let remaining = SUMMARY_CONTINUATION_ATTEMPTS
        while (remaining > 0 && result.status === "completed" && result.summary.length < SUMMARY_MIN_LENGTH) {
          const task = `${request.task}\n\n${rerunPrompt(result)}`
          result = yield* runner.run({ ...request, task })
          remaining -= 1
        }
        return result
      }),
  }
}

const defaultRerunPrompt = (previous: SubagentResult) =>
  `Your previous response was too brief (${previous.summary.length} chars < ${SUMMARY_MIN_LENGTH}). Please summarize the key conclusions, decisions, artifacts and any open questions from your work.`

/** Resume semantics: a result carrying resumeID can be continued. */
export function canResume(result: SubagentResult): result is SubagentResult & { readonly resumeID: string } {
  return result.resumeID !== undefined && (result.status === "timeout" || result.status === "interrupted")
}

/** Profile tool allowlists (M4 §4.6, kimi-code coder/explore/plan). */
export const PROFILE_TOOLS: Record<SubagentProfile, ReadonlyArray<string>> = {
  explore: ["read", "glob", "grep", "webfetch", "websearch", "bash-readonly"],
  plan: ["read", "glob", "grep", "webfetch", "websearch"],
  coder: ["read", "write", "edit", "glob", "grep", "bash", "webfetch", "websearch", "todowrite", "question"],
  custom: [],
}

export const PROFILE_READONLY: Record<SubagentProfile, boolean> = {
  explore: true,
  plan: true,
  coder: false,
  custom: false,
}
