export * as SubagentDepth from "./depth"

const DEPTH_ENV = "OPENCODE_AGENT_DEPTH"
const MAX_DEPTH = 3

export const getCurrentDepth = (): number => {
  const raw = process.env[DEPTH_ENV]
  if (!raw) return 0
  const parsed = parseInt(raw, 10)
  return Number.isFinite(parsed) ? parsed : 0
}

export const canSpawn = (): boolean => getCurrentDepth() < MAX_DEPTH

export const getChildEnv = (): Record<string, string> => {
  const current = getCurrentDepth()
  const env: Record<string, string> = {}
  for (const key of Object.keys(process.env)) {
    const value = process.env[key]
    if (value !== undefined) env[key] = value
  }
  env[DEPTH_ENV] = String(current + 1)
  return env
}

export const MAX_NESTING_DEPTH = MAX_DEPTH
