// Subprocess integration tests for `opencode daemon start/stop/status`.
// Spawns the real CLI; the daemon child inherits the isolated XDG env, so its
// state file and log land inside the fixture tempdir. Each test stops the
// daemon before finishing so no process outlives the run.
import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { HttpClient } from "effect/unstable/http"
import { cliIt } from "../../lib/cli-process"

type DaemonState = {
  readonly pid: number
  readonly url: string
  readonly username: string
  readonly password: string
  readonly version: string
  readonly startedAt: string
}

function parseStartedLine(stdout: string) {
  const match = stdout.match(/opencode daemon started at (http:\/\/\S+) \(pid (\d+), state (\S+)\)/)
  if (!match) throw new Error(`unexpected start output: ${stdout}`)
  return { url: match[1], pid: Number(match[2]), statePath: match[3] }
}

const readState = (statePath: string) =>
  Effect.promise(() => Bun.file(statePath).json<DaemonState>())

const authHeaders = (state: DaemonState) => ({
  Authorization: `Basic ${Buffer.from(`${state.username}:${state.password}`).toString("base64")}`,
})

describe("opencode daemon (subprocess)", () => {
  cliIt.live(
    "start boots a long-lived authenticated server and stop tears it down",
    ({ opencode }) =>
      Effect.gen(function* () {
        const client = yield* HttpClient.HttpClient

        const started = yield* opencode.spawn(["daemon", "start"])
        expect(started.exitCode).toBe(0)
        const { url, pid, statePath } = parseStartedLine(started.stdout)
        const state = yield* readState(statePath)
        expect(state.pid).toBe(pid)
        expect(state.url).toBe(url)
        expect(state.username).toBe("opencode")
        expect(state.password.length).toBeGreaterThan(16)

        // No credentials -> 401; with credentials -> 200.
        const denied = yield* client.get(`${url}/global/health`)
        expect(denied.status).toBe(401)
        const allowed = yield* client.get(`${url}/global/health`, {
          headers: authHeaders(state),
        })
        expect(allowed.status).toBe(200)

        // A second start is a no-op that reports the existing daemon.
        const again = yield* opencode.spawn(["daemon", "start"])
        expect(again.exitCode).toBe(0)
        expect(again.stdout).toContain("already running")

        // Instance routing works against the daemon (location-scoped boot).
        const routed = yield* client.get(`${url}/path?directory=${process.cwd()}`, {
          headers: authHeaders(state),
        })
        expect(routed.status).toBe(200)

        // restart replaces the daemon with a fresh pid on a fresh port.
        const restarted = yield* opencode.spawn(["daemon", "restart"])
        expect(restarted.exitCode).toBe(0)
        expect(restarted.stdout).toContain("stopped")
        expect(restarted.stdout).toContain("started")
        const restartedState = yield* readState(statePath)
        expect(restartedState.pid).not.toBe(pid)
        const restartedAllowed = yield* client.get(`${restartedState.url}/global/health`, {
          headers: authHeaders(restartedState),
        })
        expect(restartedAllowed.status).toBe(200)

        // status flags a daemon running an outdated version.
        yield* Effect.promise(() =>
          Bun.write(
            statePath,
            JSON.stringify({ ...restartedState, version: "0.0.0-outdated" }, null, 2),
          ),
        )
        const outdatedStatus = yield* opencode.spawn(["daemon", "status"])
        expect(outdatedStatus.exitCode).toBe(0)
        expect(outdatedStatus.stdout).toContain("daemon restart")

        // stop terminates the process and clears the state file.
        const stopped = yield* opencode.spawn(["daemon", "stop"])
        expect(stopped.exitCode).toBe(0)
        expect(stopped.stdout).toContain("stopped")
        const dead = yield* Effect.promise(() =>
          Bun.file(statePath).exists().catch(() => false),
        )
        expect(dead).toBe(false)

        // status after stop reports not running with a non-zero exit.
        const status = yield* opencode.spawn(["daemon", "status"])
        expect(status.exitCode).toBe(1)
        expect(status.stdout).toContain("not running")
      }),
    90_000,
  )
})