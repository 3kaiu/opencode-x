import { randomBytes } from "crypto"
import { readFile, rm, writeFile } from "fs/promises"
import path from "path"
import { Global } from "@opencode-ai/core/global"

export interface DaemonState {
  readonly pid: number
  readonly url: string
  readonly username: string
  readonly password: string
  readonly version: string
  readonly startedAt: string
}

export const statePath = () => path.join(Global.Path.state, "daemon.json")
export const logPath = () => path.join(Global.Path.log, "daemon.log")

export const generatePassword = () => randomBytes(24).toString("base64url")

export const readState = async (): Promise<DaemonState | undefined> => {
  try {
    const state = JSON.parse(await readFile(statePath(), "utf8")) as Partial<DaemonState>
    if (
      typeof state.pid !== "number" ||
      typeof state.url !== "string" ||
      typeof state.username !== "string" ||
      typeof state.password !== "string" ||
      typeof state.version !== "string" ||
      typeof state.startedAt !== "string"
    ) {
      return undefined
    }
    return state as DaemonState
  } catch {
    return undefined
  }
}

export const writeState = (state: DaemonState) =>
  writeFile(statePath(), JSON.stringify(state, null, 2), { mode: 0o600 })

export const removeState = () => rm(statePath(), { force: true })

export async function isHealthy(
  url: string,
  username: string,
  password: string,
  timeoutMs = 2000,
): Promise<boolean> {
  const authorization = `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`
  try {
    const response = await fetch(`${url}/global/health`, {
      headers: { Authorization: authorization },
      signal: AbortSignal.timeout(timeoutMs),
    })
    return response.status !== 401
  } catch {
    return false
  }
}

export const alive = async (pid: number) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

export const waitForExit = async (pid: number, timeoutMs = 8000) => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (!(await alive(pid))) return true
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  return !(await alive(pid))
}

const listeningPattern = /listening on (https?:\/\/\S+)/

export async function waitForListening(
  log: string,
  exited: Promise<number | null>,
  timeoutMs = 20000,
): Promise<string | undefined> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const exit = await Promise.race([exited, Promise.resolve(null)])
    if (exit !== null) return undefined
    try {
      const content = await readFile(log, "utf8")
      const match = content.match(listeningPattern)
      if (match) return match[1]
    } catch {
      // Log file may not exist yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  return undefined
}