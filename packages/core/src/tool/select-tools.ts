// V2 tool system — progressive disclosure (M3 §3.6, kimi select_tools).
// Dynamic tools (MCP batches, plugin tools, rarely used tools) must NOT enter
// the top-level tools[] array: the prompt prefix (and thus the provider's
// prompt cache) stays byte-stable. Tools are announced via
// <tools_added>/<tools_removed> markers in a system message and become
// executable next step.
export * as SelectTools from "./select-tools"

export interface ToolEntry {
  readonly name: string
  readonly definition: unknown        // provider ToolDefinition shape
  readonly dynamic: boolean           // true = progressive disclosure candidate
  readonly frequency?: number         // usage count (static tools stay static)
}

export const STATIC_TOOLS: ReadonlyArray<string> = [
  "read", "write", "edit", "bash", "glob", "grep", "webfetch", "websearch",
  "todowrite", "question", "skill", "apply_patch",
]

/** Static (always in top-level) vs dynamic (announced on demand). */
export function classify(
  tools: ReadonlyArray<ToolEntry>,
  staticNames: ReadonlyArray<string> = STATIC_TOOLS,
): { readonly staticTools: ReadonlyArray<ToolEntry>; readonly dynamicTools: ReadonlyArray<ToolEntry> } {
  const staticTools = tools.filter((t) => staticNames.includes(t.name) || !t.dynamic)
  const dynamicTools = tools.filter((t) => !staticNames.includes(t.name) && t.dynamic)
  return { staticTools, dynamicTools }
}

export interface DisclosureState {
  readonly announced: ReadonlySet<string>    // 已通过 marker 披露过的动态工具
  readonly current: ReadonlySet<string>      // 当前可执行的动态工具（下一步）
  readonly promoted: ReadonlySet<string>     // 已提升为常驻（进入顶层 tools[]）
}

export function initialState(): DisclosureState {
  return { announced: new Set(), current: new Set(), promoted: new Set() }
}

/** Renders the <tools_added> marker for newly exposed tools (kimi tools_added). */
export function renderAdded(names: ReadonlyArray<string>): string {
  if (names.length === 0) return ""
  return `<tools_added>${names.join(", ")}</tools_added>`
}

/** Renders the <tools_removed> marker for retired tools. */
export function renderRemoved(names: ReadonlyArray<string>): string {
  if (names.length === 0) return ""
  return `<tools_removed>${names.join(", ")}</tools_removed>`
}

/**
 * Decides which dynamic tools to expose for the next turn.
 * - Explicit request (the model asked for a tool by name) → expose immediately.
 * - Frequency ≥ threshold → promote to static (permanent prefix addition).
 * Returns the next state + the marker text to inject.
 */
export function decideNext(
  state: DisclosureState,
  dynamicTools: ReadonlyArray<ToolEntry>,
  requested: ReadonlyArray<string>,
  promoteThreshold = 3,
): { readonly state: DisclosureState; readonly marker: string } {
  const announced = new Set(state.announced)
  const current = new Set(state.current)
  const promoted = new Set(state.promoted)

  // expose requested tools (announce via marker; available next step)
  for (const name of requested) {
    if (dynamicTools.some((t) => t.name === name) && !current.has(name) && !promoted.has(name)) {
      current.add(name)
      announced.add(name)
    }
  }
  // promote high-frequency dynamic tools to permanent top-level
  for (const tool of dynamicTools) {
    if ((tool.frequency ?? 0) >= promoteThreshold && !promoted.has(tool.name)) {
      promoted.add(tool.name)
      announced.add(tool.name)
      current.delete(tool.name)
    }
  }
  // retire tools that dropped out of the working set
  const removed = [...current].filter((name) => !requested.includes(name))
  const addedNames = [...current].filter((n) => !state.current.has(n))
  const removedNames = removed.filter((n) => state.current.has(n))
  for (const name of removed) current.delete(name)
  const marker = [renderAdded(addedNames), renderRemoved(removedNames)].filter(Boolean).join("\n")
  return { state: { announced, current, promoted }, marker }
}

/**
 * The top-level tools[] for the request: non-dynamic tools + promoted dynamic
 * tools. Announced-but-not-promoted dynamic tools stay out of the prefix
 * (kimi select_tools: prompt prefix stays byte-stable → prompt cache hits).
 */
export function topLevelTools(
  staticTools: ReadonlyArray<ToolEntry>,
  state: DisclosureState,
): ReadonlyArray<ToolEntry> {
  return staticTools.filter((t) => !t.dynamic || state.promoted.has(t.name))
}
