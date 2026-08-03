import { describe, expect, test } from "bun:test"
import { SkillStore } from "../src/skills/skill-store"
import { Learn, type SkillCandidate } from "../src/skills/learn"
import { Index } from "../src/memory/append-index"
import { BlobStore } from "../src/memory/blob-store"
import { SearchIndex, buildPostings, incrementalIndex, searchPostings } from "../src/memory/search-index"
import { tokenize } from "../src/memory/search"
import path from "node:path"

const mkCandidate = (id: string, name: string, status: SkillCandidate["status"] = "pending"): SkillCandidate => ({
  id,
  name,
  description: `desc ${name}`,
  preconditions: [],
  steps: [{ kind: "step", title: "s1", ref: "bash" }],
  verifiers: [],
  source: "learned",
  version: 1,
  evidence: { planSteps: [{ title: "s1", tool: "bash", goal: "g" }], successRate: 1, executions: 3, sessionIDs: [] },
  status,
})

describe("SkillStore (durable skills)", () => {
  test("persists candidates and survives reload", async () => {
    const dir = `/tmp/v2skills-${Date.now()}`
    const store = await SkillStore.openSkillStore(dir)
    const candidate = mkCandidate("learned-x", "x")
    await SkillStore.saveCandidate(store, candidate)
    const reloaded = await SkillStore.replaySkills(store)
    expect(reloaded.get("learned-x")?.description).toBe("desc x")
    await Bun.$`rm -rf ${dir}`
  })

  test("confirmation persists across reloads", async () => {
    const dir = `/tmp/v2skills2-${Date.now()}`
    const store = await SkillStore.openSkillStore(dir)
    await SkillStore.saveCandidate(store, mkCandidate("learned-y", "y"))
    expect(await SkillStore.confirmSkill(store, "learned-y")).toBe(true)
    const confirmed = await SkillStore.confirmedSkills(store)
    expect(confirmed.map((s) => s.id)).toEqual(["learned-y"])
    await Bun.$`rm -rf ${dir}`
  })

  test("tolerates trailing partial line on replay", async () => {
    const dir = `/tmp/v2skills3-${Date.now()}`
    const store = await SkillStore.openSkillStore(dir)
    await SkillStore.saveCandidate(store, mkCandidate("learned-z", "z"))
    await Bun.write(store.wirePath, (await Bun.file(store.wirePath).text()) + '{"type":"skill.upsert","skill":{"id":"broken"')
    const reloaded = await SkillStore.replaySkills(store)
    expect(reloaded.get("learned-z")).toBeDefined()
    expect(reloaded.size).toBe(1)
    await Bun.$`rm -rf ${dir}`
  })
})

describe("AppendIndex (lock-free + tombstone)", () => {
  test("append/read roundtrip with tombstones", async () => {
    const dir = `/tmp/v2idx-${Date.now()}`
    const store = await Index.openIndex(dir)
    await Index.append(store, { key: "a", meta: { v: 1 } })
    await Index.append(store, { key: "b", meta: { v: 2 } })
    await Index.remove(store, "a")
    const entries = await Index.read(store)
    expect(entries.has("a")).toBe(false)
    expect(entries.get("b")?.meta).toEqual({ v: 2 })
    await Bun.$`rm -rf ${dir}`
  })

  test("path escape guard drops foreign keys", async () => {
    const dir = `/tmp/v2idx2-${Date.now()}`
    const store = await Index.openIndex(dir)
    await Index.append(store, { key: "/repo/a.ts", meta: {} })
    await Index.append(store, { key: "/etc/passwd", meta: {} })
    const guard = Index.insideRoot("/repo")
    const entries = await Index.read(store, guard)
    expect(entries.has("/repo/a.ts")).toBe(true)
    expect(entries.has("/etc/passwd")).toBe(false)
    await Bun.$`rm -rf ${dir}`
  })
})

describe("BlobStore (offload)", () => {
  test("small content stays inline, large content offloads", async () => {
    const dir = `/tmp/v2blob-${Date.now()}`
    const store = await BlobStore.openBlobStore(dir)
    const small = await BlobStore.maybeOffload(store, "tiny")
    expect(small).toBe("tiny")
    const big = await BlobStore.maybeOffload(store, "x".repeat(10_000))
    expect(typeof big).toBe("object")
    expect(await BlobStore.resolve(store, big)).toBe("x".repeat(10_000))
    await Bun.$`rm -rf ${dir}`
  })

  test("idempotent put on duplicate content", async () => {
    const dir = `/tmp/v2blob2-${Date.now()}`
    const store = await BlobStore.openBlobStore(dir)
    const content = "y".repeat(5_000)
    const ref1 = await BlobStore.put(store, content)
    const ref2 = await BlobStore.put(store, content)
    expect(ref1.ref).toBe(ref2.ref)
    await Bun.$`rm -rf ${dir}`
  })
})

describe("SearchIndex (lock-is-election)", () => {
  test("builds postings and searches by TF-IDF", () => {
    const postings = buildPostings([
      { id: "m1", text: "bun typecheck for this project" },
      { id: "m2", text: "use pnpm instead of npm here" },
    ])
    const hits = searchPostings(postings, "bun typecheck")
    expect(hits[0].id).toBe("m1")
  })

  test("incremental index skips unchanged docs", () => {
    const docs = [{ id: "m1", text: "stable content" }, { id: "m2", text: "will change" }]
    const first = buildPostings(docs)
    const second = incrementalIndex(first, [{ id: "m1", text: "stable content" }, { id: "m2", text: "changed now" }])
    expect(second.docFingerprints.get("m1")).toBe(first.docFingerprints.get("m1"))
    expect(second.docFingerprints.get("m2")).not.toBe(first.docFingerprints.get("m2"))
  })

  test("persist + fresh detection + reload", async () => {
    const dir = `/tmp/v2idx3-${Date.now()}`
    const wirePath = path.join(dir, "wire.jsonl")
    await Bun.write(wirePath, "line1\nline2\n")
    const state = await SearchIndex.openSearchIndex(dir, wirePath)
    expect(await SearchIndex.isFresh(state)).toBe(false)
    const postings = buildPostings([{ id: "m1", text: "hello world" }])
    await SearchIndex.persistIndex(state, postings)
    expect(await SearchIndex.isFresh(state)).toBe(true)
    const loaded = await SearchIndex.loadPostings(state)
    expect(loaded?.totalDocs).toBe(1)
    await Bun.$`rm -rf ${dir}`
  })

  test("lock is election: only one winner, stale lock steal", async () => {
    const dir = `/tmp/v2idx4-${Date.now()}`
    await Bun.$`mkdir -p ${dir}`
    expect(await SearchIndex.tryAcquireIndexLock(dir)).toBe(true)
    expect(await SearchIndex.tryAcquireIndexLock(dir)).toBe(false)
    // stale lock (old mtime) can be stolen
    const lockPath = path.join(dir, "index.lock")
    const old = new Date(Date.now() - 10 * 60_000)
    await Bun.file(lockPath).write("stale")
    const { utimes } = await import("node:fs/promises")
    await utimes(lockPath, old, old)
    expect(await SearchIndex.tryAcquireIndexLock(dir, 1)).toBe(true)
    await SearchIndex.releaseIndexLock(dir)
    await Bun.$`rm -rf ${dir}`
  })
})

describe("tokenize (shared)", () => {
  test("CJK bigrams and latin words", () => {
    const tokens = tokenize("测试一下 hello world")
    expect(tokens).toContain("测试")
    expect(tokens).toContain("一下")
    expect(tokens).toContain("hello")
  })
})
