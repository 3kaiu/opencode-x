// V2 verification loop (M9 §9.6).
// Verifier registry + failure semanticization + regression baseline.
// "改完" → typecheck/lint (fast) → test (slow) → e2e, with parsed failures.
export * as Verify from "./verifier"

export type FailureCategory = "compile" | "type" | "assert" | "timeout" | "unknown"

export interface Failure {
  readonly file: string
  readonly line?: number
  readonly message: string
  readonly category: FailureCategory
}

export interface VerificationResult {
  readonly verifier: string
  readonly passed: boolean
  readonly failures: ReadonlyArray<Failure>
  readonly durationMs: number
}

export interface Verifier {
  readonly id: string
  readonly command: string
  readonly args: ReadonlyArray<string>
  readonly triggers: ReadonlyArray<{ readonly glob: string; readonly verifier: string }>
  readonly cost: "fast" | "slow"
  readonly parse: (output: string) => ReadonlyArray<Failure>
}

export const DEFAULT_VERIFIERS: ReadonlyArray<Verifier> = [
  {
    id: "typecheck",
    command: "bun",
    args: ["run", "typecheck"],
    triggers: [{ glob: "**/*.ts", verifier: "typecheck" }, { glob: "**/*.tsx", verifier: "typecheck" }],
    cost: "fast",
    parse: parseTsgoOutput,
  },
  {
    id: "lint",
    command: "bun",
    args: ["run", "lint"],
    triggers: [{ glob: "**/*.ts", verifier: "lint" }],
    cost: "fast",
    parse: () => [],
  },
  {
    id: "test",
    command: "bun",
    args: ["test"],
    triggers: [{ glob: "**/*.test.ts", verifier: "test" }],
    cost: "slow",
    parse: parseBunTestOutput,
  },
]

/** tsgo/tsc output: `path(line,col): error TSxxxx: message` */
export function parseTsgoOutput(output: string): ReadonlyArray<Failure> {
  const failures: Failure[] = []
  const re = /^(.+?)\((\d+),(\d+)\):\s*error\s+TS\d+:\s*(.+)$/gm
  for (const m of output.matchAll(re)) {
    failures.push({
      file: m[1],
      line: Number(m[2]),
      message: m[4],
      category: "type",
    })
  }
  return failures
}

/** bun test output: `N pass / M fail` + failing test lines. */
export function parseBunTestOutput(output: string): ReadonlyArray<Failure> {
  const failures: Failure[] = []
  const re = /^\(fail\)\s+(.+?)\s+\[([\d.]+)ms\]$/gm
  for (const m of output.matchAll(re)) {
    failures.push({ file: "", message: m[1], category: "assert" })
  }
  return failures
}

/** Fast verifiers first, slow last — the model gets quick feedback first. */
export function orderedVerifiers(verifiers: ReadonlyArray<Verifier>): ReadonlyArray<Verifier> {
  return [...verifiers].sort((a, b) => (a.cost === b.cost ? 0 : a.cost === "fast" ? -1 : 1))
}

export interface RegressionBaseline {
  readonly knownFailures: ReadonlySet<string>   // "verifier:test-name" known pre-existing
}

export function classifyFailures(result: VerificationResult, baseline: RegressionBaseline): {
  readonly known: ReadonlyArray<Failure>
  readonly novel: ReadonlyArray<Failure>
} {
  const known: Failure[] = []
  const novel: Failure[] = []
  for (const f of result.failures) {
    const key = `${result.verifier}:${f.message}`
    if (baseline.knownFailures.has(key)) known.push(f)
    else novel.push(f)
  }
  return { known, novel }
}

/** Verification-fix loop guard: >N consecutive failures on the same verifier → suggest a strategy change. */
export function exceededRetryLimit(consecutiveFailures: number, max = 3): boolean {
  return consecutiveFailures > max
}
