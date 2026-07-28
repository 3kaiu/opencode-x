import yargs from "yargs"
import { hideBin } from "yargs/helpers"
import { UI } from "./cli/ui"
import { InstallationVersion } from "@opencode-ai/core/installation/version"
import { FormatError } from "./cli/error"
import { EOL } from "os"
import { errorMessage } from "./util/error"
import { Heap } from "./cli/heap"

const args = hideBin(process.argv)

function lazyCommand(command: string, modulePath: string, exportName: string) {
  return {
    command,
    builder: async (yargs: any) => {
      const mod = await import(modulePath)
      const cmd = mod[exportName]
      return cmd.builder ? cmd.builder(yargs) : yargs
    },
    handler: async (argv: any) => {
      const mod = await import(modulePath)
      const cmd = mod[exportName]
      return cmd.handler(argv)
    },
  }
}

function show(out: string) {
  const text = out.trimStart()
  if (!text.startsWith("opencode ")) {
    process.stderr.write(UI.logo() + EOL + EOL)
    process.stderr.write(text + EOL)
    return
  }
  process.stderr.write(out)
}

const cli = yargs(args)
  .parserConfiguration({ "populate--": true })
  .scriptName("opencode")
  .wrap(100)
  .help("help", "show help")
  .alias("help", "h")
  .version("version", "show version number", InstallationVersion)
  .alias("version", "v")
  .option("print-logs", {
    describe: "print logs to stderr",
    type: "boolean",
  })
  .option("log-level", {
    describe: "log level",
    type: "string",
    choices: ["DEBUG", "INFO", "WARN", "ERROR"],
  })
  .option("pure", {
    describe: "run without external plugins",
    type: "boolean",
  })
  .middleware(async (opts) => {
    if (opts.printLogs) process.env.OPENCODE_PRINT_LOGS = "1"
    if (opts.logLevel) process.env.OPENCODE_LOG_LEVEL = opts.logLevel
    if (opts.pure) {
      process.env.OPENCODE_PURE = "1"
    }

    Heap.start()

    process.env.AGENT = "1"
    process.env.OPENCODE = "1"
    process.env.OPENCODE_PID = String(process.pid)

    if (typeof OTUI_TREE_SITTER_WORKER_PATH !== "undefined") {
      process.env.OTUI_TREE_SITTER_WORKER_PATH = OTUI_TREE_SITTER_WORKER_PATH
    }
  })
  .usage("")
  .completion("completion", "generate shell completion script")
  .command(
    lazyCommand("mcp", "./cli/cmd/mcp", "McpCommand"),
  )
  .command(
    lazyCommand("tui", "./cli/cmd/tui", "TuiThreadCommand"),
  )
  .command(
    lazyCommand("attach", "./cli/cmd/attach", "AttachCommand"),
  )
  .command(
    lazyCommand("run [message..]", "./cli/cmd/run", "RunCommand"),
  )
  .command(
    lazyCommand("generate", "./cli/cmd/generate", "GenerateCommand"),
  )
  .command(
    lazyCommand("debug", "./cli/cmd/debug", "DebugCommand"),
  )
  .command(
    lazyCommand("providers", "./cli/cmd/providers", "ProvidersCommand"),
  )
  .command(
    lazyCommand("agent", "./cli/cmd/agent", "AgentCommand"),
  )
  .command(
    lazyCommand("upgrade", "./cli/cmd/upgrade", "UpgradeCommand"),
  )
  .command(
    lazyCommand("uninstall", "./cli/cmd/uninstall", "UninstallCommand"),
  )
  .command(
    lazyCommand("serve", "./cli/cmd/serve", "ServeCommand"),
  )
  .command(
    lazyCommand("models", "./cli/cmd/models", "ModelsCommand"),
  )
  .command(
    lazyCommand("export", "./cli/cmd/export", "ExportCommand"),
  )
  .command(
    lazyCommand("session", "./cli/cmd/session", "SessionCommand"),
  )
  .command(
    lazyCommand("plug", "./cli/cmd/plug", "PluginCommand"),
  )
  .command(
    lazyCommand("db", "./cli/cmd/db", "DbCommand"),
  )
  .fail((msg, err) => {
    if (
      msg?.startsWith("Unknown argument") ||
      msg?.startsWith("Not enough non-option arguments") ||
      msg?.startsWith("Invalid values:")
    ) {
      if (err) throw err
      cli.showHelp(show)
    }
    if (err) throw err
    process.exit(1)
  })
  .strict()

try {
  if (args.includes("-h") || args.includes("--help")) {
    await cli.parse(args, (err: Error | undefined, _argv: unknown, out: string) => {
      if (err) throw err
      if (!out) return
      show(out)
    })
  } else {
    await cli.parse()
  }
} catch (e) {
  const formatted = FormatError(e)
  if (formatted) UI.error(formatted)
  if (formatted === undefined) {
    UI.error("Unexpected error" + EOL)
    process.stderr.write(errorMessage(e) + EOL)
  }
  process.exitCode = 1
} finally {
  // Some subprocesses don't react properly to SIGTERM and similar signals.
  // Most notably, some docker-container-based MCP servers don't handle such signals unless
  // run using `docker run --init`.
  // Explicitly exit to avoid any hanging subprocesses.
  process.exit()
}
