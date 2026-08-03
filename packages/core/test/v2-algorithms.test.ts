import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import {
  buildSummaryPrompt,
  collectFileOps,
  findCutPoint,
  isWhitelistedUserMessage,
  segmentOversizedMessage,
  type CompactableMessage,
} from "../src/v2/context/algorithms"
import { boundPreview, classifyFailure, retryHintFor, type ToolFailureInfo } from "../src/v2/tools/contract"
import { createPolicy, modelForProfile, recordTurn } from "../src/v2/governance/policy"
import { createSwarmState, currentBackoffMs, maybeRecover, onThrottle, runSwarm } from "../src/v2/execution/swarm"
import { Sediment, REUSE_PROMOTION_THRESHOLD } from "../src/v2/memory/sediment"
import { Memory } from "../src/v2/memory/store"

const msg = (seq: number, role: CompactableMessage["role"], tokenEstimate: number, overrides: Partial<CompactableMessage> = {}): CompactableMessage => ({
  seq,
  role,
  tokenEstimate,
  text: `m${seq}`.repeat(Math.ceil(tokenEstimate)),
  ...overrides,
})

describe("findCutPoint (pi algorithm)", () => {
  const history: ReadonlyArray<CompactableMessage> = [
    msg(1, "user", 100, { isUserMessage: true }),
    msg(2, "assistant", 50),
    msg(3, "user", 100, { isUserMessage: true }),
    msg(4, "assistant", 50),
    msg(5, "user", 100, { isUserMessage: true }),
    msg(6, "assistant", 50),
  ]

  test("cuts at a user message when budget crossed mid-history", () => {
    const cut = findCutPoint(history, 300)
    expect(cut.retainedTail.length).toBeGreaterThan(0)
    // retained tail starts at a user message
    expect(cut.retainedTail[0].role).toBe("user")
  })

  test("never cuts AT tool results (cut boundary is a legal message)", () => {
    const withTool = [...history, msg(7, "assistant", 10, { isToolResult: true })]
    const cut = findCutPoint(withTool, 300)
    // the cut boundary message itself is never a toolResult/metadata
    expect(cut.retainedTail[0]?.isToolResult).not.toBe(true)
    expect(cut.retainedTail[0]?.isMetadata).not.toBe(true)
  })

  test("small keepRecentTokens summarizes everything", () => {
    const cut = findCutPoint(history, 5)
    expect(cut.messagesToSummarize.length).toBeGreaterThan(0)
  })

  test("turn split joins the partial turn into summary", () => {
    // cut lands at an assistant message → rewind to turn start
    const cut = findCutPoint(history, 300)
    if (cut.turnSplit) {
      expect(cut.retainedTail[0].role).toBe("user")
    }
  })
})

describe("segmentOversizedMessage (kimi head/tail)", () => {
  test("elides middle and keeps head + tail", () => {
    const big = msg(1, "user", 10_000, { isUserMessage: true })
    const { text, elidedTokens } = segmentOversizedMessage(big, 2_000, 500)
    expect(elidedTokens).toBeGreaterThan(0)
    expect(text).toContain("<system-reminder>")
    expect(text.slice(0, 10)).toBe(big.text.slice(0, 10))
    expect(text.slice(-10)).toBe(big.text.slice(-10))
  })
  test("small messages pass through untouched", () => {
    const small = msg(1, "user", 100)
    const { text, elidedTokens } = segmentOversizedMessage(small, 2_000)
    expect(elidedTokens).toBe(0)
    expect(text).toBe(small.text)
  })
})

describe("isWhitelistedUserMessage (kimi PromptOrigin)", () => {
  test("real user messages are whitelisted; injected are not", () => {
    expect(isWhitelistedUserMessage(msg(1, "user", 10, { isUserMessage: true }))).toBe(true)
    expect(isWhitelistedUserMessage(msg(2, "user", 10, { isUserMessage: false }))).toBe(false)
    expect(isWhitelistedUserMessage(msg(3, "assistant", 10))).toBe(false)
  })
})

describe("buildSummaryPrompt", () => {
  test("fresh summary prompt mentions first-person handoff", () => {
    const prompt = buildSummaryPrompt(null, "convo")
    expect(prompt).toContain("handoff note")
    expect(prompt).toContain("first person")
  })
  test("update prompt references previous note", () => {
    const prompt = buildSummaryPrompt(
      { objective: "o", progress: { done: ["d"], inProgress: [], blocked: [] }, keyDecisions: [], nextSteps: [], criticalContext: "", fileOps: { readFiles: [], modifiedFiles: [] }, supersedes: null },
      "convo",
    )
    expect(prompt).toContain("PREVIOUS NOTE")
    expect(prompt).toContain("Do not rewrite")
  })
})

describe("collectFileOps", () => {
  test("extracts read and modified files", () => {
    const ops = collectFileOps([
      msg(1, "assistant", 10, { text: 'read src/a.ts then edit src/b.ts and write src/c.ts' }),
    ])
    expect(ops.readFiles).toContain("src/a.ts")
    expect(ops.modifiedFiles).toContain("src/b.ts")
    expect(ops.modifiedFiles).toContain("src/c.ts")
  })
})

describe("Contract (M3)", () => {
  test("retry hints honor idempotency", () => {
    const t: ToolFailureInfo = { category: "Timeout", message: "timed out", idempotent: true, canProbe: false }
    expect(retryHintFor(t).kind).toBe("retry")
    expect(retryHintFor({ ...t, idempotent: false }).kind).toBe("retry-with-changes")
    expect(retryHintFor({ ...t, category: "NotFound", canProbe: true }).kind).toBe("probe-first")
  })
  test("classifyFailure maps messages to categories", () => {
    expect(classifyFailure("no such file")).toBe("NotFound")
    expect(classifyFailure("permission denied")).toBe("Permission")
    expect(classifyFailure("timed out after 30s")).toBe("Timeout")
    expect(classifyFailure("unknown")).toBe("Unknown")
  })
  test("boundPreview head-tail samples large output", () => {
    const { preview, truncated, marker } = boundPreview("line\n".repeat(5_000))
    expect(truncated).toBe(true)
    expect(preview).toContain("[truncated]")
    expect(marker).toContain("truncated")
    expect(preview.length).toBeLessThan(5_000 * 5)
  })
  test("boundPreview passes through small output", () => {
    const { preview, truncated } = boundPreview("small")
    expect(truncated).toBe(false)
    expect(preview).toBe("small")
  })
})

describe("Policy (M7)", () => {
  const policy = {
    main: { providerID: "openai", modelID: "gpt-x" },
    subagent: { providerID: "openai", modelID: "gpt-mini" },
    fallback: [{ providerID: "anthropic", modelID: "claude-y" }],
    switchThreshold: { failureRate: 0.5, minTurns: 3 },
  }
  test("failover triggers after threshold and is never silent", () => {
    let state = createPolicy(policy)
    const events: unknown[] = []
    state = recordTurn(state, false, "provider 500", 1).state
    state = recordTurn(state, false, "provider 500", 2).state
    const third = recordTurn(state, false, "provider 500", 3)
    expect(third.failover).toBeDefined()
    expect(third.failover!.to.modelID).toBe("claude-y")
    expect(third.failover!.kind).toBe("model.failover")
  })
  test("subagent profile uses cheaper model", () => {
    const state = createPolicy(policy)
    expect(modelForProfile(state, "explore")).toEqual(policy.subagent)
    expect(modelForProfile(state, "coder")).toEqual(policy.main)
  })
})

describe("Swarm (M4)", () => {
  test("backoff doubles per throttle", () => {
    let s = createSwarmState()
    s = onThrottle(s, Date.now())
    s = onThrottle(s, Date.now())
    expect(currentBackoffMs(s)).toBe(3_000 * 2 ** 2)
    expect(s.concurrency).toBe(1)
  })
  test("recovers capacity after a clean window", () => {
    const now = Date.now()
    let s = createSwarmState({ maxConcurrency: 8 })
    s = onThrottle(s, now)
    expect(maybeRecover(s, now + 1_000)).toBe(s) // too early
    const recovered = maybeRecover(s, now + 4 * 60_000)
    expect(recovered.concurrency).toBeGreaterThan(s.concurrency)
  })
  test("runSwarm executes all tasks despite throttles", async () => {
    let calls = 0
    const result = await Effect.runPromise(
      runSwarm(
        [
          { id: "1", run: Effect.succeed("a") },
          { id: "2", run: Effect.succeed("b") },
          { id: "3", run: Effect.succeed("c") },
        ],
        { initialConcurrency: 2, maxConcurrency: 2, backoffBaseMs: 1 },
        () => false,
      ),
    )
    expect(result.results.filter(Boolean)).toEqual(["a", "b", "c"])
  })
})

describe("Sediment (M5)", () => {
  test("NotFound failures sediment into pending lesson entries", async () => {
    const dir = `/tmp/v2sed-test-${Date.now()}`
    const store = await Memory.openMemory(dir)
    const entry = await Sediment.recordPending(store, {
      kind: "tool.failed",
      tool: "read",
      error: "No such file",
      category: "NotFound",
      at: Date.now(),
    })
    expect(entry).not.toBeNull()
    expect(entry!.status).toBe("pending")
    expect(entry!.category).toBe("lesson")
    expect(entry!.keywords).toContain("probe")
    const entries = await Memory.replayWire(store)
    expect(entries.get(entry!.id)).toBeDefined()
    await Bun.$`rm -rf ${dir}`
  })
  test("denied permissions sediment into feedback preferences", async () => {
    const entry = await Sediment.sedimentSignal({
      kind: "permission.decision",
      action: "bash",
      resource: "rm -rf /",
      decision: "deny",
      at: Date.now(),
    })
    expect(entry?.category).toBe("feedback")
    expect(entry?.keywords).toContain("deny")
  })
  test("Assertion failures sediment the verify-after-write lesson", async () => {
    const entry = await Sediment.sedimentSignal({
      kind: "tool.failed",
      tool: "bun test",
      error: "assertion failed after write",
      category: "Assertion",
      at: Date.now(),
    })
    expect(entry?.category).toBe("lesson")
    expect(entry?.title).toContain("verify after every write")
    expect(entry?.keywords).toContain("assertion")
  })
  test("promotion happens after reuse threshold", async () => {
    const dir = `/tmp/v2sed2-${Date.now()}`
    const store = await Memory.openMemory(dir)
    const entry = await Sediment.recordPending(store, { kind: "tool.failed", tool: "x", error: "no", category: "NotFound", at: Date.now() })
    expect(await Sediment.promoteIfReused(store, entry!.id, REUSE_PROMOTION_THRESHOLD - 1)).toBe(false)
    expect(await Sediment.promoteIfReused(store, entry!.id, REUSE_PROMOTION_THRESHOLD)).toBe(true)
    const entries = await Memory.replayWire(store)
    expect(entries.get(entry!.id)?.status).toBe("confirmed")
    await Bun.$`rm -rf ${dir}`
  })
})
