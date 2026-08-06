// V2 runner cost accounting (M7 §7.6): usage-first ledger with cost tiers.
export * as RunnerCost from "./cost"

export const safe = (value: number | undefined) => Math.max(0, Number.isFinite(value) ? (value ?? 0) : 0)

export interface UsageInput {
  readonly inputTokens?: number
  readonly outputTokens?: number
  readonly cacheReadInputTokens?: number
  readonly cacheWriteInputTokens?: number
  readonly reasoningTokens?: number
}

export interface CostTier {
  readonly input: number
  readonly output: number
  readonly cacheRead?: number
  readonly cacheWrite?: number
}

/** Computes step cost from provider usage and catalog cost tiers (per 1M tokens). */
export function computeCost(
  usage: UsageInput,
  costTiers: ReadonlyArray<CostTier>,
): number {
  const tier = costTiers.find((c) => c.input > 0) ?? costTiers[0]
  if (!tier) return 0
  const input = safe(usage.inputTokens)
  const output = safe(usage.outputTokens)
  const cacheRead = safe(usage.cacheReadInputTokens)
  const cacheWrite = safe(usage.cacheWriteInputTokens)
  const reasoning = safe(usage.reasoningTokens)
  const nonCachedInput = Math.max(0, input - cacheRead - cacheWrite)
  const visibleOutput = Math.max(0, output - reasoning)
  const cacheReadRate = tier.cacheRead ?? tier.input
  const cacheWriteRate = tier.cacheWrite ?? tier.input
  return (
    (nonCachedInput * tier.input + cacheRead * cacheReadRate + cacheWrite * cacheWriteRate) / 1_000_000 +
    (visibleOutput * tier.output + reasoning * tier.output) / 1_000_000
  )
}
