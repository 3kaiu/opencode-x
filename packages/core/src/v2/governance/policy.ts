// V2 cost & model governance — routing policy (M7 §7.6).
// main / subagent / fallback chain; failover events never silent; switch
// suggestions triggered by failure-rate signals.
export * as Policy from "./policy"

export interface ModelRef {
  readonly providerID: string
  readonly modelID: string
}

export interface ModelPolicy {
  readonly main: ModelRef
  readonly subagent: ModelRef
  readonly fallback?: ReadonlyArray<ModelRef>
  readonly switchThreshold?: { readonly failureRate: number; readonly minTurns: number }
}

export interface FailoverEvent {
  readonly kind: "model.failover"
  readonly from: ModelRef
  readonly to: ModelRef
  readonly reason: string
  readonly seq: number
}

export interface PolicyState {
  readonly policy: ModelPolicy
  readonly active: ModelRef
  readonly events: ReadonlyArray<FailoverEvent>
  readonly turnCount: number
  readonly failureCount: number
}

export function createPolicy(policy: ModelPolicy): PolicyState {
  return { policy, active: policy.main, events: [], turnCount: 0, failureCount: 0 }
}

/** Records a turn outcome; returns a failover event when the threshold is hit. */
export function recordTurn(state: PolicyState, ok: boolean, reason: string, seq: number): {
  readonly state: PolicyState
  readonly failover?: FailoverEvent
} {
  const turnCount = state.turnCount + 1
  const failureCount = state.failureCount + (ok ? 0 : 1)
  const threshold = state.policy.switchThreshold ?? { failureRate: 0.5, minTurns: 3 }
  const next = { ...state, turnCount, failureCount }
  if (ok || turnCount < threshold.minTurns) return { state: next }
  const rate = failureCount / turnCount
  if (rate < threshold.failureRate) return { state: next }
  // threshold hit: fail over to the next model in the chain
  const chain = [state.policy.main, ...(state.policy.fallback ?? [])]
  const idx = chain.findIndex((m) => m.modelID === state.active.modelID && m.providerID === state.active.providerID)
  const nextModel = chain[idx + 1]
  if (!nextModel) return { state: next }   // no fallback left — stay
  const failover: FailoverEvent = {
    kind: "model.failover",
    from: state.active,
    to: nextModel,
    reason,
    seq,
  }
  return { state: { ...next, active: nextModel, events: [...state.events, failover] }, failover }
}

/** Failover is never silent: emit the event to the event bus (M6). */
export function emitFailover(
  state: PolicyState,
  emit: (event: FailoverEvent) => void,
  reason: string,
  seq: number,
): PolicyState {
  const { state: next, failover } = recordTurn(state, false, reason, seq)
  if (failover) emit(failover)
  return next
}

/** Subagent tasks default to the cheaper model (M7 §7.6 rule 5). */
export function modelForProfile(state: PolicyState, profile: "coder" | "explore" | "plan"): ModelRef {
  if (profile === "explore" || profile === "plan") return state.policy.subagent
  return state.active
}

/** Cost-aware choice: among models with same capability tier, pick cheapest. */
export function cheapest(
  candidates: ReadonlyArray<{ readonly model: ModelRef; readonly costPer1K?: number }>,
): ModelRef {
  return [...candidates].sort((a, b) => (a.costPer1K ?? Infinity) - (b.costPer1K ?? Infinity))[0].model
}
