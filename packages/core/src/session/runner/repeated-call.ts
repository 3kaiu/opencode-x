// V2 runner repeated-tool-call bound: identical consecutive calls get a
// corrective message instead of re-execution.
export * as RunnerRepeatedCall from "./repeated-call"

export const MAX_REPEATED_TOOL_CALLS = 2

// Canonicalizes tool arguments so JSON key order does not defeat the comparison.
export const canonicalizeInput = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalizeInput)
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((key) => [key, canonicalizeInput((value as Record<string, unknown>)[key])]),
    )
  }
  return value
}

export type RepeatedToolCall = { readonly name: string; readonly input: string; readonly count: number }

// Returns a corrective message when the call repeats an identical tool call
// more than the allowed bound, otherwise records the call and returns nothing.
export function boundRepeatedToolCalls(
  tracker: { current?: RepeatedToolCall },
  call: { name: string; input: unknown },
): string | undefined {
  const input = JSON.stringify(canonicalizeInput(call.input))
  const current = tracker.current
  if (current && current.name === call.name && current.input === input) {
    tracker.current = { name: call.name, input, count: current.count + 1 }
    if (tracker.current.count > MAX_REPEATED_TOOL_CALLS)
      return `You called ${call.name} with the identical input ${tracker.current.count} consecutive times. The result will not change. Stop repeating this call and change your approach.`
    return
  }
  tracker.current = { name: call.name, input, count: 1 }
  return
}
