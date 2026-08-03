// V2 end-to-end smoke test: mock LLMClient runs the full task loop through the
// real pipeline — M1 projection → Provider.buildRequest → collectEvents →
// M3 conflict-graph scheduler → lifecycle events → wire persistence →
// skill learning → cross-session recovery.
import { describe, expect, test } from "bun:test"
import { Effect, Stream } from "effect"
import { LLMClient, Model, ModelID, ToolDefinition, Usage, type LLMEvent } from "@opencode-ai/llm"
import { OpenAIResponses } from "@opencode-ai/llm/protocols/openai-responses"
import { Orchestrator, type OrchestratorDeps } from "../src/v2/execution/orchestrator"
import { Provider } from "../src/v2/execution/provider"
import { Projection } from "../src/v2/context/projection"
import { Scheduler, type SchedulableTool } from "../src/v2/tools/scheduler"
import { Memory } from "../src/v2/memory/store"
import { Sediment } from "../src/v2/memory/sediment"
import { SkillStore } from "../src/v2/skills/skill-store"
import { Learn, type SkillCandidate } from "../src/v2/skills/learn"

const mkModel = () =>
  Model.make({
    id: ModelID.make("gpt-smoke"),
    provider: "openai" as const,
    route: OpenAIResponses.route,
  })

interface VirtualFile {
  readonly name: string
  content: string
}

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

/**
 * Scripted LLM: turn 1 calls read+search in parallel; turn 2 calls write;
 * turn 3 answers with plain text. Mirrors a real agentic task.
 */
const script = (): ReadonlyArray<ReadonlyArray<LLMEvent>> => [
  [
    ...readEvents("t1", "read", '{"path":"/missing.ts"}'),
    ...readEvents("t1b", "read", '{"path":"/missing.ts"}'),   // duplicate identical call
    ...readEvents("t2", "search", '{"query":"bun bug"}'),
    finish("tool-calls", 100, 20),
  ],
  [
    ...readEvents("t3", "write", '{"path":"/src/a.ts","content":"fixed"}'),
    finish("tool-calls", 60, 10),
  ],
  [
    { type: "text-start", id: "b1" },
    { type: "text-delta", id: "b1", text: "Done: fixed the bun bug." },
    { type: "text-end", id: "b1" },
    finish("stop", 30, 5),
  ],
]

describe("V2 end-to-end loop (mock provider)", () => {
  test("full task loop: projection → stream → conflict-graph tools → lifecycle → persistence", async () => {
    const dir = `/tmp/v2e2e-${Date.now()}`
    const mem = await Memory.openMemory(dir)
    const skills = await SkillStore.openSkillStore(pathJoin(dir, "skills"))

    const model = mkModel()
    const files: Array<VirtualFile> = [{ name: "/src/a.ts", content: "export const a = 1\n" }]
    let maxConcurrent = 0
    let inflight = 0
    const executed: string[] = []
    const usageLog: Array<Provider.Usage> = []
    const historySizes: number[] = []

    const toolDefs = [
      { name: "read", definition: new ToolDefinition({ name: "read", description: "read a file", inputSchema: {} }) },
      { name: "search", definition: new ToolDefinition({ name: "search", description: "search the codebase", inputSchema: {} }) },
      { name: "write", definition: new ToolDefinition({ name: "write", description: "write a file", inputSchema: {} }) },
    ]

    const settle = (call: { readonly id: string; readonly name: string; readonly input: unknown }) =>
      Effect.gen(function* () {
        inflight++
        maxConcurrent = Math.max(maxConcurrent, inflight)
        const input = call.input as { path?: string; query?: string; content?: string }
        if (call.name === "read") {
          yield* Effect.promise(() => new Promise((r) => setTimeout(r, 10)))
          const f = files.find((x) => x.name === input.path)
          if (!f) {
            yield* Effect.promise(() =>
              Sediment.recordPending(mem, {
                kind: "tool.failed", tool: "read", error: "ENOENT", category: "NotFound", at: Date.now(),
              }),
            )
            executed.push(`read:${input.path}`)
            return `read ${input.path}: not found`
          }
          executed.push(`read:${input.path}`)
          return `read ${input.path}: ${f.content}`
        } else if (call.name === "search") {
          yield* Effect.promise(() => new Promise((r) => setTimeout(r, 1)))
          executed.push(`search:${input.query}`)
          return `search "${input.query}": 1 hit in /src/a.ts`
        } else if (call.name === "write") {
          const f = files.find((x) => x.name === input.path)
          if (f) {
            f.content = input.content ?? ""
            executed.push(`write:${input.path}`)
          }
          yield* Effect.promise(() => SkillStore.saveCandidate(skills, mkSkill(`${call.id}-skill`, "fix-bun-bug")))
          return `write ${input.path}: ok`
        }
        return "no-op"
      })

    const scripted = script()
    let turn = 0
    const fakeLlm: Provider.LlmStreamer = {
      stream: () => Stream.fromIterable(scripted[Math.min(turn++, scripted.length - 1)]),
    }

    const deps: OrchestratorDeps = {
      runProviderTurn: (projection, prompt, toolHistory) => {
        historySizes.push(toolHistory?.length ?? 0)
        return Provider.streamTurn({
          llm: fakeLlm,
          request: Provider.buildRequest({ projection, model, tools: toolDefs, prompt, toolHistory }),
          onUsage: (u) => usageLog.push(u),
        })
      },
    }

    const tools: ReadonlyArray<SchedulableTool> = [
      { name: "read", access: [{ kind: "file", op: "read", path: "/src/a.ts" }] },
      { name: "search", access: [{ kind: "network" }] },
      { name: "write", access: [{ kind: "file", op: "write", path: "/src/a.ts" }] },
    ]

    const result = await Effect.runPromise(
      Orchestrator.runLoop(deps, {
        prompt: "Investigate the bun bug in /src/a.ts and fix it.",
        source: "user",
        system: [Projection.piece.system("You are a terse agent.")],
        world: [Projection.piece.world("cwd=/repo")],
        instructions: [Projection.piece.instruction("Use bun. Report at the end.")],
        memory: [Projection.piece.memory("prefer minimal diffs", "mem-1")],
        history: [Projection.piece.history("user: fix the bun bug")],
        live: [],
        tools,
        settle,
      }),
    )

    // ---- orchestration: 3 turns, right tool calls per turn ----
    expect(result.turns).toHaveLength(3)
    expect(result.turns[0].toolCalls.map((t) => t.name).sort()).toEqual(["read", "read", "search"])
    expect(result.turns[1].toolCalls.map((t) => t.name)).toEqual(["write"])
    expect(result.turns[2].toolCalls).toHaveLength(0)
    expect(result.turns[2].stopReason).toBe("end")

    // ---- dedupe: duplicate identical call executed once; output shared ----
    expect(executed.filter((x) => x.startsWith("read"))).toEqual(["read:/missing.ts"])
    expect(result.turns[0].toolOutputs).toHaveLength(3)
    expect(result.turns[0].toolOutputs[0]).toBe("read /missing.ts: not found")
    expect(result.turns[0].toolOutputs[1]).toBe("read /missing.ts: not found")

    // ---- conflict-graph: read+search ran in parallel (same wave), search (1ms) finished first ----
    expect(maxConcurrent).toBeGreaterThanOrEqual(2)
    expect(executed).toEqual(["search:bun bug", "read:/missing.ts", "write:/src/a.ts"])

    // ---- lifecycle events: one started/completed per unique execution ----
    const lifecycle = result.turns.flatMap((t) => t.lifecycle)
    expect(lifecycle.filter((e) => e.phase === "started")).toHaveLength(3)
    expect(lifecycle.filter((e) => e.phase === "completed")).toHaveLength(3)

    // ---- usage captured on every turn ----
    expect(usageLog).toHaveLength(3)
    expect(usageLog[0].input).toBe(100)
    expect(usageLog[2].output).toBe(5)

    // ---- projection: six layers + fingerprint ----
    expect(result.turns[0].projection.layers.system.length).toBeGreaterThan(0)
    expect(result.turns[0].fingerprint.length).toBeGreaterThan(0)

    // ---- structured tool feedback: pairs grow turn by turn, rendered outputs ----
    expect(historySizes).toEqual([0, 4, 6])       // turn1: none; turn2: read+search pair; turn3: +write pair
    expect(result.turns[0].toolMessages).toHaveLength(4)  // 2 calls × (assistant + tool)
    const toolMsg = result.turns[0].toolMessages.find((m) => m.role === "tool")
    expect(toolMsg?.content[0].type).toBe("tool-result")
    expect(result.turns[0].toolOutputs).toContain("read /missing.ts: not found")
    expect(result.turns[1].toolOutputs).toContain("write /src/a.ts: ok")
    // ---- wire persistence: lesson recorded on failed read ----
    const wire = await Memory.replayWire(mem)
    const lessons = [...wire.values()].filter((e) => e.category === "lesson")
    expect(lessons.length).toBeGreaterThanOrEqual(1)
    expect(lessons[0].status).toBe("pending")
    expect(lessons[0].title).toContain("probe before acting")
    await Memory.confirmEntry(mem, lessons[0].id)
    const confirmed = await Memory.replayWire(mem)
    expect(confirmed.get(lessons[0].id)?.status).toBe("confirmed")

    // ---- skill learning persisted ----
    const replayed = await SkillStore.replaySkills(skills)
    expect(replayed.size).toBeGreaterThanOrEqual(1)
    expect([...replayed.values()][0].name).toBe("fix-bun-bug")

    // ---- cross-session recovery: fresh handles replay from disk ----
    const mem2 = await Memory.openMemory(dir)
    const skills2 = await SkillStore.openSkillStore(pathJoin(dir, "skills"))
    expect(await Memory.replayWire(mem2)).toHaveLength(wire.size)
    expect((await SkillStore.replaySkills(skills2)).size).toBe(replayed.size)

    await Bun.$`rm -rf ${dir}`
  })
})

function pathJoin(...parts: string[]): string {
  return parts.join("/")
}

function mkSkill(id: string, name: string): SkillCandidate {
  return {
    id,
    name,
    description: `skill for ${name}`,
    preconditions: [],
    steps: [{ kind: "step", title: "fix", ref: "bash" }],
    verifiers: [],
    source: "learned",
    version: 1,
    evidence: { planSteps: [{ title: "fix", tool: "bash", goal: "g" }], successRate: 1, executions: 1, sessionIDs: [] },
    status: "pending",
  }
}
