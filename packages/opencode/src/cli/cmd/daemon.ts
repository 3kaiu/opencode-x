import { Flock } from "@opencode-ai/core/util/flock"
import { InstallationVersion } from "@opencode-ai/core/installation/version"
import { cmd } from "@/cli/cmd/cmd"
import { UI } from "@/cli/ui"
import {
  alive,
  generatePassword,
  isHealthy,
  logPath,
  readState,
  removeState,
  statePath,
  waitForExit,
  waitForListening,
  writeState,
} from "@/daemon/state"

const DEFAULT_USERNAME = "opencode"

function serveCommand() {
  const binPath = process.env.OPENCODE_BIN_PATH
  if (binPath) return { command: binPath, args: [] as string[] }
  const argv = process.argv.slice(1)
  const scriptIndex = argv.findIndex((arg) => /\.(ts|tsx|js|mjs)$/.test(arg))
  if (scriptIndex !== -1) {
    const conditions = argv
      .slice(0, scriptIndex)
      .filter((arg) => arg === "--conditions" || arg.startsWith("--conditions="))
    return { command: process.execPath, args: [...conditions, argv[scriptIndex]] }
  }
  return { command: process.execPath, args: [] as string[] }
}

async function healthy(state: Awaited<ReturnType<typeof readState>>) {
  if (!state) return false
  return isHealthy(state.url, state.username, state.password)
}

async function start(port: number) {
  await using _ = await Flock.acquire("daemon", { timeoutMs: 5000, staleMs: 30000 })

  const existing = await readState()
  if (await healthy(existing)) {
    console.log(`opencode daemon already running at ${existing!.url} (pid ${existing!.pid})`)
    return
  }
  if (existing) {
    if (await alive(existing.pid)) {
      try {
        process.kill(existing.pid, "SIGKILL")
      } catch {}
    }
    await removeState()
  }

  const password = generatePassword()
  const { command, args } = serveCommand()
  const exit = Promise.withResolvers<number | null>()
  // Truncate the log so waitForListening only matches this daemon's line
  // (restart would otherwise pick up a stale "listening on" from a previous run).
  await Bun.write(logPath(), "")
  const child = Bun.spawn(
    [command, ...args, "serve", "--port", String(port), "--hostname", "127.0.0.1"],
    {
      // New session: the daemon must survive the starting CLI process and any
      // parent process-group kill (e.g. the test harness or a dying shell).
      detached: true,
      env: { ...process.env, OPENCODE_SERVER_PASSWORD: password, OPENCODE_DAEMON: "1" },
      stdout: Bun.file(logPath()),
      stderr: Bun.file(logPath()),
      onExit: (proc) => exit.resolve(proc.exitCode),
    },
  )

  const url = await waitForListening(logPath(), exit.promise)
  if (!url) {
    child.kill()
    UI.error(`opencode daemon failed to start; see ${logPath()}`)
    process.exitCode = 1
    return
  }

  await writeState({
    pid: child.pid,
    url,
    username: DEFAULT_USERNAME,
    password,
    version: InstallationVersion,
    startedAt: new Date().toISOString(),
  })
  child.unref()
  console.log(`opencode daemon started at ${url} (pid ${child.pid}, state ${statePath()})`)
}

async function stop() {
  const state = await readState()
  if (!state) {
    console.log("opencode daemon is not running")
    return
  }
  if (await alive(state.pid)) {
    try {
      process.kill(state.pid, "SIGTERM")
    } catch {}
    if (!(await waitForExit(state.pid))) {
      try {
        process.kill(state.pid, "SIGKILL")
      } catch {}
      await waitForExit(state.pid, 2000)
    }
  }
  await removeState()
  console.log("opencode daemon stopped")
}

async function status() {
  const state = await readState()
  if (!state) {
    console.log("opencode daemon is not running")
    process.exitCode = 1
    return
  }
  const healthyState = await isHealthy(state.url, state.username, state.password)
  console.log(
    `opencode daemon ${healthyState ? "running" : "unreachable"} at ${state.url} (pid ${state.pid}, version ${state.version}, started ${state.startedAt})`,
  )
  if (state.version !== InstallationVersion) {
    console.log(`daemon is running version ${state.version}; run \`opencode daemon restart\` to pick up ${InstallationVersion}`)
  }
  if (!healthyState) process.exitCode = 1
}

export const DaemonCommand = cmd({
  command: "daemon <action>",
  describe: "manage the opencode daemon (local container layer serving many projects)",
  builder: (yargs: any) =>
    yargs
      .positional("action", {
        type: "string",
        choices: ["start", "stop", "restart", "status"],
        describe: "daemon lifecycle action",
      })
      .option("port", {
        type: "number",
        describe: "port to listen on (default: random)",
      }),
  handler: async (args: any) => {
    switch (args.action) {
      case "start":
        await start(args.port ?? 0)
        return
      case "stop":
        await stop()
        return
      case "restart":
        await stop()
        await start(args.port ?? 0)
        return
      case "status":
        await status()
        return
    }
  },
})