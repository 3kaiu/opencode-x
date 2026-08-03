// V2 cost & model governance — usage ledger + budget gate (M7 §7.6).
// Three-level accumulation (task → session → project), alert/hard-stop gate.
export * as Governance from "./ledger"

export interface Usage {
  readonly input: number
  readonly output: number
  readonly reasoning: number
  readonly cacheRead: number
  readonly cacheWrite: number
  readonly cost: number
}

export const emptyUsage = (): Usage => ({
  input: 0,
  output: 0,
  reasoning: 0,
  cacheRead: 0,
  cacheWrite: 0,
  cost: 0,
})

export function addUsage(a: Usage, b: Partial<Usage> | undefined): Usage {
  if (!b) return a
  return {
    input: a.input + (b.input ?? 0),
    output: a.output + (b.output ?? 0),
    reasoning: a.reasoning + (b.reasoning ?? 0),
    cacheRead: a.cacheRead + (b.cacheRead ?? 0),
    cacheWrite: a.cacheWrite + (b.cacheWrite ?? 0),
    cost: a.cost + (b.cost ?? 0),
  }
}

export function usageTotal(u: Usage): number {
  return u.input + u.output + u.reasoning + u.cacheRead + u.cacheWrite
}

export interface CostBudget {
  readonly limit: number        // 单任务成本上限（美元）
  readonly alertAt: number      // 预警比例（0..1）
  readonly hardStopAt: number   // 硬停比例（0..1）
}

export const DEFAULT_COST_BUDGET: CostBudget = { limit: 2.0, alertAt: 0.5, hardStopAt: 0.9 }

export type GateState = "ok" | "alert" | "hardstop"

/** Three-tier gate: ok → alert (suggest) → hardstop (stop + summary). */
export function evaluateGate(spent: number, budget: CostBudget): GateState {
  if (spent >= budget.limit * budget.hardStopAt) return "hardstop"
  if (spent >= budget.limit * budget.alertAt) return "alert"
  return "ok"
}

export interface Ledger {
  readonly byTask: ReadonlyMap<string, Usage>
  readonly sessionTotal: Usage
  readonly byModel: ReadonlyMap<string, Usage>
}

export const emptyLedger = (): Ledger => ({
  byTask: new Map(),
  sessionTotal: emptyUsage(),
  byModel: new Map(),
})

export function recordUsage(ledger: Ledger, taskID: string | null, modelKey: string | null, usage: Usage): Ledger {
  const byTask = new Map(ledger.byTask)
  if (taskID) byTask.set(taskID, addUsage(byTask.get(taskID) ?? emptyUsage(), usage))
  const byModel = new Map(ledger.byModel)
  if (modelKey) byModel.set(modelKey, addUsage(byModel.get(modelKey) ?? emptyUsage(), usage))
  return { byTask, sessionTotal: addUsage(ledger.sessionTotal, usage), byModel }
}
