// V2 skills — definition, location priority, matching (M10 §10.6).
// Skill = instantiated plan tree (M8) with params, preconditions, verifiers.
// Location priority: builtin < user < project < explicit (kimi roots.ts).
export * as Skills from "./skill"

export type SkillSource = "builtin" | "user" | "project" | "learned" | "explicit"

export interface SkillStep {
  readonly kind: "step" | "skill"
  readonly title: string
  /** For kind=skill: referenced skill id. For kind=step: tool name + args template. */
  readonly ref: string
  readonly params?: Record<string, string>
  readonly fallback?: string     // 步骤失败时的回退描述
}

export interface Skill {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly whenToUse?: string
  readonly extends?: string
  readonly params?: ReadonlyArray<{ readonly name: string; readonly required?: boolean; readonly default?: string }>
  readonly preconditions: ReadonlyArray<string>
  readonly steps: ReadonlyArray<SkillStep>
  readonly verifiers: ReadonlyArray<string>
  readonly source: SkillSource
  readonly version: number
}

export const SKILL_PRIORITY: Record<SkillSource, number> = {
  builtin: 0,
  user: 10,
  project: 30,
  learned: 20,
  explicit: 40,
}

/** Higher priority wins on name collision. */
export function resolveSkills(skills: ReadonlyArray<Skill>): ReadonlyArray<Skill> {
  const byName = new Map<string, Skill>()
  for (const skill of skills) {
    const existing = byName.get(skill.name)
    if (!existing || SKILL_PRIORITY[skill.source] >= SKILL_PRIORITY[existing.source]) {
      byName.set(skill.name, skill)
    }
  }
  return [...byName.values()]
}

/** Simple description matching: token overlap of query vs description + whenToUse. */
export function matchSkill(skills: ReadonlyArray<Skill>, query: string, topK = 3): ReadonlyArray<Skill> {
  const q = new Set(query.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean))
  const scored = skills
    .map((s) => {
      const hay = `${s.description} ${s.whenToUse ?? ""}`.toLowerCase()
      const tokens = new Set(hay.split(/[^a-z0-9]+/).filter(Boolean))
      let hits = 0
      for (const t of q) if (tokens.has(t)) hits++
      return { skill: s, score: q.size === 0 ? 0 : hits / q.size }
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
  return scored.map((s) => s.skill)
}

/** Instantiates a skill into a plan-tree seed (M8): steps become plan nodes. */
export function toPlanSeed(skill: Skill): ReadonlyArray<{
  readonly id: string
  readonly title: string
  readonly goal: string
  readonly dependsOn: ReadonlyArray<string>
}> {
  let prev: string | null = null
  return skill.steps.map((step, i) => {
    const node = {
      id: `${skill.name}-step-${i}`,
      title: step.title,
      goal: step.kind === "skill" ? `run skill ${step.ref}` : `${step.ref} ${JSON.stringify(step.params ?? {})}`,
      dependsOn: prev ? [prev] : [],
    }
    prev = node.id
    return node
  })
}
