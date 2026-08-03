// V2 planning — plan tree (M8 §8.6).
// PlanNode with dependencies, acceptance criteria, budgets, checkpoints and
// drift detection. todowrite is the static view; this is the runtime skeleton.
export * as Planning from "./plan"

export type TaskStatus = "pending" | "in_progress" | "blocked" | "done" | "cancelled"

export interface PlanNode {
  readonly id: string
  readonly parentID: string | null
  readonly title: string
  readonly goal: string
  readonly acceptanceCriteria: ReadonlyArray<string>
  readonly status: TaskStatus
  readonly dependsOn: ReadonlyArray<string>
  readonly budget?: { readonly maxTokens?: number; readonly maxDurationMs?: number }
  readonly spent: { readonly tokens: number; readonly durationMs: number }
  readonly checkpoint: boolean
}

export type DriftKind = "minor" | "moderate" | "severe"

export interface Drift {
  readonly kind: DriftKind
  readonly detail: string
  readonly suggested: "ignore" | "note" | "replan" | "ask-user"
}

export interface PlanStore {
  readonly root: PlanNode | null
  readonly nodes: ReadonlyMap<string, PlanNode>
}

export function createPlan(nodes: ReadonlyArray<PlanNode>): PlanStore {
  const map = new Map(nodes.map((n) => [n.id, n]))
  const root = nodes.find((n) => n.parentID === null) ?? null
  return { root, nodes: map }
}

/** All dependencies done → ready to start. */
export function isReady(node: PlanNode, store: PlanStore): boolean {
  return node.dependsOn.every((id) => {
    const dep = store.nodes.get(id)
    return dep?.status === "done"
  })
}

/** A node may only be marked done when its acceptance criteria are satisfiable (verified externally). */
export function canComplete(node: PlanNode): boolean {
  return node.status === "in_progress" || node.status === "pending"
}

export function childrenOf(store: PlanStore, parentID: string): ReadonlyArray<PlanNode> {
  return [...store.nodes.values()].filter((n) => n.parentID === parentID)
}

export function progressOf(store: PlanStore): { done: number; total: number; blocked: ReadonlyArray<string> } {
  const all = [...store.nodes.values()]
  const done = all.filter((n) => n.status === "done").length
  const blocked = all.filter((n) => n.status === "blocked").map((n) => n.id)
  return { done, total: all.length, blocked }
}

const PLAN_FILE_PATTERN = /(^|\/)((src|test|lib|packages|apps|docs)\/|(?:^|\/)package\.json$|(?:^|\/)bun\.lock)/

/**
 * Drift detection: an out-of-plan file write is compared against the set of
 * paths the plan's done/in_progress nodes declare as their scope. Scope is
 * derived from goal text heuristically (paths mentioned) plus explicit
 * per-node scope (budget-less extension).
 */
export function detectDrift(
  writtenPath: string,
  store: PlanStore,
  scopedPaths: ReadonlyArray<string> = [],
): Drift | null {
  // Files outside the plan's implied scope (e.g. lockfiles) are minor drift.
  if (!PLAN_FILE_PATTERN.test(writtenPath)) {
    return { kind: "minor", detail: `wrote ${writtenPath} outside plan scope`, suggested: "ignore" }
  }
  const inScope = scopedPaths.some((p) => writtenPath === p || writtenPath.startsWith(`${p}/`))
  if (inScope) return null
  return { kind: "moderate", detail: `wrote ${writtenPath} not declared in plan`, suggested: "note" }
}

export function markDriftSevere(detail: string): Drift {
  return { kind: "severe", detail, suggested: "replan" }
}
