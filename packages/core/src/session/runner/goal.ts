// V2 runner goal mode (M8 §8.6): session-level task statement injected into
// the system layer plus bounded continuations after write-then-stop turns.
export * as RunnerGoal from "./goal"

export const GOAL_MAX_CONTINUATIONS = 3

export function goalSystemText(goal: string): string {
  return `You are working toward this goal: ${goal}\nContinue working until the goal is complete. Do not finish early; if verification failed, fix it and verify again.`
}

export function goalOf(metadata: Record<string, unknown> | undefined): string | undefined {
  const goal = metadata?.goal
  return typeof goal === "string" && goal.length > 0 ? goal : undefined
}
