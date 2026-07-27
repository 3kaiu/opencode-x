// Playful present-participle verbs shown next to the busy spinner, Claude-Code style.
export const ACTIVITY_VERBS = [
  "Thinking",
  "Working",
  "Cooking",
  "Brewing",
  "Pondering",
  "Crunching",
  "Noodling",
  "Tinkering",
  "Conjuring",
  "Percolating",
  "Wrangling",
  "Computing",
  "Musing",
  "Scheming",
] as const

// Pick a stable verb for a given seed so it does not flicker between renders.
export function activityVerb(seed: number) {
  const index = Math.abs(Math.trunc(seed)) % ACTIVITY_VERBS.length
  return ACTIVITY_VERBS[index]
}
