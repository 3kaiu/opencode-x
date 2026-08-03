// opencode-x V2 architecture (LLM-consumer-centric, specs/v2/llm-consumer-architecture.md).
//
// This namespace is a NEW implementation track: V2 modules live under
// `packages/core/src/v2/` and are exported as `@opencode-ai/core/v2/...`.
// Functional modules are copied from the legacy tree and adapted into the V2
// namespace; global singletons (Database, event tables, Location, node makers)
// are shared through `v2/shared/*` — they must never be instantiated twice.
//
// Module map (architecture doc §0.5):
//   M1 Context Projection  → v2/context
//   M2 World Perception    → v2/world
//   M3 Tool System         → v2/tools
//   M4 Execution/Delegation→ v2/execution
//   M5 Memory              → v2/memory
//   M6 Events/Feedback     → v2/events
//   M7 Cost/Model Gov.     → v2/governance
//   M8 Planning            → v2/planning
//   M9 Verification        → v2/verify
//   M10 Skills             → v2/skills
//   M11 Security/Trust     → v2/security
//   M12 Introspection      → v2/introspection

export * as V2Events from "./events/bus"
export * as V2Lifecycle from "./events/lifecycle"
export * as V2ToolRegistry from "./tools/registry"
export * as V2Tools from "./tools/tools"
export * as V2Tool from "./tools/tool"
export * as V2ApplicationTools from "./tools/application-tools"
export * as V2Scheduler from "./tools/scheduler"
export * as V2SystemContext from "./context/system-context"
export * as V2SystemContextRegistry from "./context/registry"
export * as V2ContextLevels from "./context/context-levels"
export * as V2SessionCompaction from "./context/compaction"
export * as V2ContextBudget from "./context/budget"
export * as V2Projection from "./context/projection"
export * as V2CompactionAlgo from "./context/algorithms"
export * as V2WorldSnapshot from "./world/snapshot"
export * as V2WorldProbe from "./world/probe"
export * as V2FileIndex from "./world/file-index"
export * as V2Debounce from "./world/debounce"
export * as V2Parallel from "./execution/parallel"
export * as V2Subagent from "./execution/subagent"
export * as V2Swarm from "./execution/swarm"
export * as V2Orchestrator from "./execution/orchestrator"
export * as V2Provider from "./execution/provider"
export * as V2Memory from "./memory/store"
export * as V2MemorySearch from "./memory/search"
export * as V2Sediment from "./memory/sediment"
export * as V2MemoryIndex from "./memory/append-index"
export * as V2SearchIndex from "./memory/search-index"
export * as V2BlobStore from "./memory/blob-store"
export * as V2Planning from "./planning/plan"
export * as V2Verify from "./verify/verifier"
export * as V2Skills from "./skills/skill"
export * as V2Learn from "./skills/learn"
export * as V2SkillStore from "./skills/skill-store"
export * as V2Isolation from "./security/isolation"
export * as V2Governance from "./governance/ledger"
export * as V2Policy from "./governance/policy"
export * as V2Introspection from "./introspection/attribution"
export * as V2Loop from "./introspection/loop"
export * as V2Contract from "./tools/contract"
export * as V2SelectTools from "./tools/select-tools"
export * as V2ToolCache from "./tools/cache"
