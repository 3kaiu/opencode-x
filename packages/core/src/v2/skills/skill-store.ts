// V2 skills — durable store (M10 §10.6 + M5 wire pattern).
// Skill candidates/confirmations persist via append-only wire log so learned
// skills survive process restarts. Reuse the same crash-tolerant wire format
// as memory (M5 §5.6).
export * as SkillStore from "./skill-store"

import { promises as fs } from "node:fs"
import path from "node:path"
import type { Skill } from "./skill"
import type { SkillCandidate } from "./learn"

export type SkillWireEvent =
  | { readonly type: "skill.upsert"; readonly skill: SkillCandidate }
  | { readonly type: "skill.status"; readonly id: string; readonly status: "confirmed" | "rejected" }

export interface SkillStore {
  readonly dir: string
  readonly wirePath: string
}

export async function openSkillStore(dir: string): Promise<SkillStore> {
  await fs.mkdir(dir, { recursive: true })
  return { dir, wirePath: path.join(dir, "skills.wire.jsonl") }
}

export async function appendSkillWire(store: SkillStore, event: SkillWireEvent): Promise<void> {
  await fs.appendFile(store.wirePath, `${JSON.stringify(event)}\n`, { flag: "a" })
}

/** Replays the wire log into a skill map, tolerating a trailing partial line. */
export async function replaySkills(store: SkillStore): Promise<Map<string, SkillCandidate>> {
  let text: string
  try {
    text = await fs.readFile(store.wirePath, "utf8")
  } catch {
    return new Map()
  }
  if (text.endsWith("\n")) text = text.slice(0, -1)
  const skills = new Map<string, SkillCandidate>()
  for (const line of text.split("\n")) {
    if (!line.trim()) continue
    try {
      const event = JSON.parse(line) as SkillWireEvent
      if (event.type === "skill.upsert") skills.set(event.skill.id, event.skill)
      else if (event.type === "skill.status") {
        const existing = skills.get(event.id)
        if (existing) skills.set(event.id, { ...existing, status: event.status })
      }
    } catch {
      // trailing partial line — ignore (crash tolerance)
    }
  }
  return skills
}

/** Persists a candidate (or re-persists an updated one). */
export async function saveCandidate(store: SkillStore, skill: SkillCandidate): Promise<void> {
  await appendSkillWire(store, { type: "skill.upsert", skill })
}

export async function confirmSkill(store: SkillStore, id: string): Promise<boolean> {
  const skills = await replaySkills(store)
  if (!skills.has(id)) return false
  await appendSkillWire(store, { type: "skill.status", id, status: "confirmed" })
  return true
}

export async function rejectSkill(store: SkillStore, id: string): Promise<boolean> {
  const skills = await replaySkills(store)
  if (!skills.has(id)) return false
  await appendSkillWire(store, { type: "skill.status", id, status: "rejected" })
  return true
}

/** Confirmed skills usable at runtime (merged with builtin/user/project skills). */
export async function confirmedSkills(store: SkillStore): Promise<ReadonlyArray<SkillCandidate>> {
  const skills = await replaySkills(store)
  return [...skills.values()].filter((s) => s.status === "confirmed")
}

/** Clean-up: compact the wire log by rewriting it without rejected/duplicate entries. */
export async function compactWire(store: SkillStore): Promise<void> {
  const skills = await replaySkills(store)
  const lines = [...skills.values()].map((s) => JSON.stringify({ type: "skill.upsert", skill: s }))
  await fs.writeFile(store.wirePath, lines.join("\n") + (lines.length > 0 ? "\n" : ""))
}

export type { Skill }
