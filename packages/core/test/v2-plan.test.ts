import { describe, expect, test } from "bun:test"
import { Effect, Stream } from "effect"
import { Model, ModelID, ToolDefinition, Usage, type LLMEvent } from "@opencode-ai/llm"
import { OpenAIResponses } from "@opencode-ai/llm/protocols/openai-responses"
import { Orchestrator, type OrchestratorDeps } from "../src/v2/execution/orchestrator"
import { Provider } from "../src/v2/execution/provider"
import { Projection } from "../src/v2/context/projection"
import { Verify } from "../src/v2/verify/verifier"
import { Trigger } from "../src/v2/verify/trigger"
import type { SchedulableTool } from "../src/v2/tools/scheduler"

const mkModel = () =>
  Model.make({
    id: ModelID.make("gpt-plan"),
    provider: "openai" as const,
    route: OpenAIResponses.route,
  })

const readEvents = (id: string, name: string, raw: string): ReadonlyArray<LLMEvent> => [
  { type: "tool-input-start", id, name },
  { type: "tool-input-delta", id, name, text: raw },
  { type: "tool-input-end", id, name },
]

const finish = (reason: "tool-calls" | "stop", input: number, output: number): LLMEvent => ({
  type: "finish",
  reason,
  usage: new Usage({ inputTokens: input, outputTokens: output, cacheReadInputTokens: 0, cacheWriteInputTokens: 0, reasoningTokens: 0 }),
})

const toolDefs = [
  { name: "read", definition: new ToolDefinition({ name: "read", description: "read", inputSchema: {} }) },
  { name: "write", definition: new ToolDefinition({ name: "write", description: "write", inputSchema: {} }) },
  { name: "run", definition: new ToolDefinition({ name: "run", description: "run", inputSchema: {} }) },
]

const tools: ReadonlyArray<SchedulableTool> = [
  { name: "read", access: [{ kind: "file", op: "read", path: "/r" }] },
  { name: "write", access: [{ kind: "file", op: "write", path: "/r" }] },
  { name: "run", access: [{ kind: "global" }] },
]

interface ScriptedDeps {
  readonly deps: OrchestratorDeps
  readonly historySizes: number[]
  readonly prompts: string[]
}

/** Scripts one turn per plan node: node goals drive which turn the LLM returns. */
function makeDeps(scriptByGoal: (goal: string) => ReadonlyArray<LLMEvent>): ScriptedDeps {
  const historySizes: number[] = []
  const prompts: string[] = []
  const deps: OrchestratorDeps = {
    runProviderTurn: (projection, prompt, toolHistory) => {
      prompts.push(prompt)
      historySizes.push(toolHistory?.length ?? 0)
      return Provider.streamTurn({
        llm: { stream: () => Stream.fromIterable(scriptByGoal(prompt)) },
        request: Provider.buildRequest({ projection, model: mkModel(), tools: toolDefs, prompt }),
      })
    },
  }
  return { deps, historySizes, prompts }
}

const baseState: Omit<Orchestrator.TurnInput, "prompt" | "tools" | "settle"> = {
  source: "user",
  system: [Projection.piece.system("sys")],
  world: [],
  instructions: [],
  memory: [],
  history: [],
  live: [],
}

describe("Orchestrator.runLoop steer buffer + auto-verify (M6/M9)", () => {
  test("steer queue flushes one input per idle step boundary", async () => {
    const prompts: string[] = []
    const scriptByGoal = (goal: string): ReadonlyArray<LLMEvent> => {
      prompts.push(goal)
      return [{ type: "text-start", id: "b1" }, { type: "text-delta", id: "b1", text: `answered: ${goal.slice(0, 10)}` }, { type: "text-end", id: "b1" }, finish("stop", 10, 1)]
    }
    const { deps } = makeDeps(scriptByGoal)
    const result = await Effect.runPromise(
      Orchestrator.runLoop(deps, {
        ...baseState,
        prompt: "main task",
        queuedSteer: ["steer A", "steer B"],
        tools,
        settle: () => Effect.succeed("ok"),
      }, 10),
    )
    expect(prompts).toEqual(["main task", "steer A", "steer B"])
    expect(result.turns).toHaveLength(3)
    expect(result.turns[1].projection.layers.history).toContain("[user] steer A")
  })

  test("auto-verify reports written files and feeds the next turn", async () => {
    let turns = 0
    const scriptByGoal = (): ReadonlyArray<LLMEvent> => {
      turns++
      if (turns === 1) return [...readEvents("w1", "write", '{"path":"/r/src/a.ts","content":"fixed"}'), finish("tool-calls", 10, 1)]
      return [{ type: "text-start", id: "b1" }, { type: "text-delta", id: "b1", text: "done" }, { type: "text-end", id: "b1" }, finish("stop", 10, 1)]
    }
    const { deps } = makeDeps(scriptByGoal)
    const verifiedPaths: Array<readonly string[]> = []
    const result = await Effect.runPromise(
      Orchestrator.runLoop(
        {
          ...deps,
          autoVerify: (paths) => {
            verifiedPaths.push(paths)
            return Effect.succeed(["typecheck: FAILED — /r/src/a.ts: type 'string' is not assignable", "test: passed"])
          },
        },
        { ...baseState, prompt: "task", tools, settle: () => Effect.succeed("ok") },
        5,
      ),
    )
    expect(verifiedPaths).toEqual([["/r/src/a.ts"]])
    const second = result.turns[1].projection.layers.history
    expect(second).toContain("[verify] typecheck: FAILED — /r/src/a.ts: type 'string' is not assignable")
    expect(second).toContain("[verify] test: passed")
  })

  test("no auto-verify runs when a turn makes no writes", async () => {
    const { deps } = makeDeps(() => [...readEvents("r1", "read", '{"path":"/r/a.ts"}'), finish("tool-calls", 10, 1)])
    const verified: Array<readonly string[]> = []
    await Effect.runPromise(
      Orchestrator.runLoop(
        { ...deps, autoVerify: (paths) => Effect.sync(() => { verified.push(paths); return [] }) },
        { ...baseState, prompt: "task", tools, settle: () => Effect.succeed("ok") },
        3,
      ),
    )
    expect(verified).toEqual([])
  })
})

describe("Trigger (M9)", () => {
  test("matchingVerifiers picks verifiers by written-path glob", () => {
    const verifiers = Verify.DEFAULT_VERIFIERS
    expect(Trigger.matchingVerifiers(verifiers, ["src/a.ts"]).map((v) => v.id).sort()).toEqual(["lint", "typecheck"])
    expect(Trigger.matchingVerifiers(verifiers, ["test/a.test.ts"]).map((v) => v.id).sort()).toEqual(["lint", "test", "typecheck"])
    expect(Trigger.matchingVerifiers(verifiers, ["README.md"])).toEqual([])
  })

  test("renderReports formats pass/fail compactly", () => {
    const reports = [
      { verifier: "typecheck", passed: false, failures: [{ file: "a.ts", message: "boom", category: "type" as const }], output: "", exitCode: 1 },
      { verifier: "test", passed: true, failures: [], output: "", exitCode: 0 },
    ]
    const lines = Trigger.renderReports(reports)
    expect(lines[0]).toContain("typecheck: FAILED — a.ts: boom")
    expect(lines[1]).toBe("test: passed")
  })
})

describe("Orchestrator.runPlan (M8 goal-driven)", () => {
  test("walks ready nodes in dependency order, verifying each", async () => {
    // node1: read (accepts read call); node2 depends on node1: fix via write; node3: verify via run
    const scriptByGoal = (goal: string): ReadonlyArray<LLMEvent> => {
      if (goal.includes("read")) return [...readEvents("r1", "read", '{"path":"/r/a.ts"}'), finish("tool-calls", 10, 1)]
      if (goal.includes("fix")) return [...readEvents("w1", "write", '{"path":"/r/a.ts","content":"fixed"}'), finish("tool-calls", 10, 1)]
      return [...readEvents("x1", "run", '{"command":"bun test"}'), finish("stop", 10, 1)]
    }
    const { deps } = makeDeps(scriptByGoal)

    const plan = [
      { id: "n1", parentID: null, title: "read", goal: "read /r/a.ts", acceptanceCriteria: [], status: "pending" as const, dependsOn: [], spent: { tokens: 0, durationMs: 0 }, checkpoint: false },
      { id: "n2", parentID: null, title: "fix", goal: "fix the bug in /r/a.ts", acceptanceCriteria: [], status: "pending" as const, dependsOn: ["n1"], spent: { tokens: 0, durationMs: 0 }, checkpoint: true },
      { id: "n3", parentID: null, title: "verify", goal: "verify with bun test", acceptanceCriteria: [], status: "pending" as const, dependsOn: ["n2"], spent: { tokens: 0, durationMs: 0 }, checkpoint: false },
    ]
    const result = await Effect.runPromise(
      Orchestrator.runPlan(
        deps,
        { ...baseState, prompt: "plan", tools, settle: () => Effect.succeed("ok") },
        plan,
        (node, turn) => {
          if (node.id === "n1") return turn.toolCalls.some((t) => t.name === "read")
          if (node.id === "n2") return turn.toolCalls.some((t) => t.name === "write")
          return turn.toolCalls.some((t) => t.name === "run")
        },
      ),
    )
    expect(result.completed).toEqual(["n1", "n2", "n3"])
    expect(result.blocked).toEqual([])
    expect(result.turns).toHaveLength(3)
  })

  test("retries a node up to the cap, then blocks it and continues", async () => {
    let fixAttempts = 0
    const scriptByGoal = (goal: string): ReadonlyArray<LLMEvent> => {
      if (goal.includes("read")) return [...readEvents("r1", "read", '{"path":"/r/a.ts"}'), finish("tool-calls", 10, 1)]
      if (goal.includes("fix")) {
        fixAttempts++
        // never performs the write the verifier wants
        return [...readEvents("x1", "run", '{"command":"bun test"}'), finish("tool-calls", 10, 1)]
      }
      return [...readEvents("x1", "run", '{"command":"bun test"}'), finish("stop", 10, 1)]
    }
    const { deps, prompts } = makeDeps(scriptByGoal)
    const plan = [
      { id: "n1", parentID: null, title: "read", goal: "read /r/a.ts", acceptanceCriteria: [], status: "pending" as const, dependsOn: [], spent: { tokens: 0, durationMs: 0 }, checkpoint: false },
      { id: "n2", parentID: null, title: "fix", goal: "fix the bug in /r/a.ts", acceptanceCriteria: [], status: "pending" as const, dependsOn: ["n1"], spent: { tokens: 0, durationMs: 0 }, checkpoint: true },
    ]
    const result = await Effect.runPromise(
      Orchestrator.runPlan(
        deps,
        { ...baseState, prompt: "plan", tools, settle: () => Effect.succeed("ok") },
        plan,
        (node, turn) => (node.id === "n2" ? turn.toolCalls.some((t) => t.name === "write") : true),
        [],
        2,
      ),
    )
    expect(result.completed).toEqual(["n1"])
    expect(result.blocked).toEqual(["n2"])
    expect(fixAttempts).toBe(2)
    expect(prompts.filter((p) => p.includes("fix"))).toHaveLength(2)
  })

  test("records drift for out-of-scope writes", async () => {
    const scriptByGoal = (goal: string): ReadonlyArray<LLMEvent> =>
      [...readEvents("w1", "write", '{"path":"/r/src/other.ts","content":"x"}'), finish("tool-calls", 10, 1)]
    const { deps } = makeDeps(scriptByGoal)
    const plan = [
      { id: "n1", parentID: null, title: "fix", goal: "fix /r/src/a.ts", acceptanceCriteria: [], status: "pending" as const, dependsOn: [], spent: { tokens: 0, durationMs: 0 }, checkpoint: false },
    ]
    const result = await Effect.runPromise(
      Orchestrator.runPlan(
        deps,
        { ...baseState, prompt: "plan", tools, settle: () => Effect.succeed("ok") },
        plan,
        () => true,
        ["/r/src/a.ts"],
      ),
    )
    expect(result.drift.length).toBeGreaterThan(0)
    expect(result.drift[0].kind).toBe("moderate")
    expect(result.drift[0].detail).toContain("/r/src/other.ts")
  })
})
