import { Context } from "effect"
import { DEFAULT_SAMPLING_PRODUCTION } from "../constants"
import type { Mode, ProfilingSwitches } from "../config"
export interface RunContext {
  readonly level: Mode
  readonly sampling: number
  readonly profiling: ProfilingSwitches
}

export const defaultRunContext: RunContext = {
  level: "production",
  sampling: DEFAULT_SAMPLING_PRODUCTION,
  profiling: {
    cpu: false,
    memory: false,
    latency: false,
    token: false,
    io: false,
    network: false,
    storage: false,
    queue: false,
  },
}

export const RunContext = Context.Service<RunContext>("Observability/RunContext")

export function shouldSample(context: RunContext, salt: string): boolean {
  if (context.sampling >= 1) return true
  let hash = 0
  for (let i = 0; i < salt.length; i++) hash = (hash * 31 + salt.charCodeAt(i)) >>> 0
  return (hash % 1000) / 1000 < context.sampling
}
