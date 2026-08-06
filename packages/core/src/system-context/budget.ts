// V2 context budget allocator (M1 §1.3/§1.6).
// Allocates per-layer token budgets for a provider request. Layers never drop
// below their floor; excess is trimmed from the top (live > history > memory).
export * as ContextBudget from "./budget"

export const LayerBudget = {
  system: 0, world: 1, instructions: 2, memory: 3, history: 4, live: 5,
} as const
export type LayerName = keyof typeof LayerBudget

export const LAYER_ORDER: ReadonlyArray<LayerName> = [
  "system", "world", "instructions", "memory", "history", "live",
]

export interface LayerConfig {
  readonly floor: number          // 永不被挤出的下限
  readonly cap: number            // 上限（超限时压缩下层优先）
}

export const DEFAULT_LAYERS: Record<LayerName, LayerConfig> = {
  system: { floor: 2_000, cap: 6_000 },          // 能力声明 + 工具契约
  world: { floor: 500, cap: 2_000 },             // 环境基线（压缩后常驻）
  instructions: { floor: 1_000, cap: 4_000 },    // AGENTS.md 链 + 偏好
  memory: { floor: 0, cap: 3_000 },              // 记忆检索注入
  history: { floor: 1_000, cap: 8_000 },         // 近全远摘要
  live: { floor: 0, cap: 2_000 },                // 世界实时增量
}

export interface Budget {
  readonly window: number
  readonly layers: Record<LayerName, number>
  readonly total: number
  readonly headroom: number      // window - total
}

/** Percentages of the window reserved for each layer (sums to 1.0). */
const SHARE: Record<LayerName, number> = {
  system: 0.25, world: 0.08, instructions: 0.16, memory: 0.12, history: 0.32, live: 0.08,
}

/**
 * Allocates budgets. Honors floors first, then distributes shares scaled to
 * the window, capping each layer at its cap. If the capped sum leaves surplus,
 * the surplus is distributed to layers with remaining room (history first,
 * then system). Returns allocation + headroom.
 */
export function allot(window: number, config: Record<LayerName, LayerConfig> = DEFAULT_LAYERS): Budget {
  const floors = Object.fromEntries(LAYER_ORDER.map((l) => [l, config[l].floor])) as Record<LayerName, number>
  const floorSum = LAYER_ORDER.reduce((acc, l) => acc + floors[l], 0)
  if (floorSum >= window) {
    // Window too small for floors: scale floors proportionally.
    const scaled = Object.fromEntries(
      LAYER_ORDER.map((l) => [l, Math.floor((floors[l] / floorSum) * window)]),
    ) as Record<LayerName, number>
    return { window, layers: scaled, total: window, headroom: 0 }
  }
  const available = window - floorSum
  const shares = Object.fromEntries(LAYER_ORDER.map((l) => [l, SHARE[l]])) as Record<LayerName, number>
  const shareSum = LAYER_ORDER.reduce((acc, l) => acc + shares[l], 0)
  const layers = {} as Record<LayerName, number>
  let remaining = available
  // Round 1: proportional share, capped at cap-floor.
  for (const l of LAYER_ORDER) {
    const shareAmount = Math.floor((shares[l] / shareSum) * available)
    const room = config[l].cap - config[l].floor
    const amount = Math.min(shareAmount, room)
    layers[l] = config[l].floor + amount
    remaining -= amount
  }
  // Round 2: distribute surplus to layers with room, history first then system.
  const surplusOrder: ReadonlyArray<LayerName> = ["history", "system", "world", "instructions", "memory", "live"]
  for (const l of surplusOrder) {
    if (remaining <= 0) break
    const room = config[l].cap - layers[l]
    if (room <= 0) continue
    const give = Math.min(remaining, room)
    layers[l] += give
    remaining -= give
  }
  const total = LAYER_ORDER.reduce((acc, l) => acc + layers[l], 0)
  return { window, layers, total, headroom: window - total }
}

/** True when the sum of used tokens across layers exceeds 85% of the window. */
export function needsCompaction(budget: Budget, used: Record<LayerName, number>): boolean {
  const usedTotal = LAYER_ORDER.reduce((acc, l) => acc + (used[l] ?? 0), 0)
  return usedTotal > budget.window * 0.85
}
