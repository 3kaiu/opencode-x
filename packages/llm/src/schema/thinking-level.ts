import { Schema } from "effect"

export const ThinkingLevels = ["minimal", "low", "medium", "high", "xhigh", "max"] as const
export type ThinkingLevel = (typeof ThinkingLevels)[number]

export const ThinkingLevel = Schema.Literals(ThinkingLevels)

export type ThinkingLevelMap = Partial<Record<ThinkingLevel, string | null>>

export const clampThinkingLevel = (level: ThinkingLevel, map: ThinkingLevelMap): string | undefined => {
  if (map[level] !== undefined) return map[level] ?? undefined
  const idx = ThinkingLevels.indexOf(level)
  for (let i = idx + 1; i < ThinkingLevels.length; i++) {
    const v = map[ThinkingLevels[i]]
    if (v !== undefined) return v ?? undefined
  }
  for (let i = idx - 1; i >= 0; i--) {
    const v = map[ThinkingLevels[i]]
    if (v !== undefined) return v ?? undefined
  }
}

export const getSupportedThinkingLevels = (map: ThinkingLevelMap): ThinkingLevel[] =>
  (ThinkingLevels as readonly string[]).filter(
    (level): level is ThinkingLevel => map[level as ThinkingLevel] !== undefined,
  )
