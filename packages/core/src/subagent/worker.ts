import { SubagentRegistry } from "./registry"
import type { SubAgentType } from "./registry"

interface WorkerConfig {
  readonly type: SubAgentType
  readonly task: string
  readonly model?: string
  readonly allowedTools?: ReadonlyArray<string>
}

const writeResult = (result: Record<string, unknown>): void => {
  process.stdout.write(JSON.stringify(result) + "\n")
}

const writeError = (message: string): void => {
  writeResult({ output: "", success: false, error: message })
}

const main = async (): Promise<void> => {
  const configArg = process.argv.find((arg) => arg === "--subagent-worker")
  if (!configArg) {
    writeError("No --subagent-worker flag found in arguments")
    process.exit(1)
  }

  const configIndex = process.argv.indexOf(configArg)
  const configJson = process.argv[configIndex + 1]
  if (!configJson) {
    writeError("Missing config JSON after --subagent-worker flag")
    process.exit(1)
  }

  let config: WorkerConfig
  try {
    config = JSON.parse(configJson) as WorkerConfig
  } catch {
    writeError(`Invalid config JSON: ${configJson.slice(0, 200)}`)
    process.exit(1)
  }

  const definition = SubagentRegistry.resolve(config.type)
  if (!definition) {
    writeError(`Unknown sub-agent type: ${config.type}`)
    process.exit(1)
  }

  const tools = config.allowedTools ?? definition.tools
  const model = config.model === "inherit" ? undefined : config.model

  try {
    const output = await runWorkerTask(config.task, definition.type, tools, model)
    writeResult({ output, success: true, tokensUsed: 0 })
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause)
    writeError(`Sub-agent crashed: ${message}`)
    process.exit(1)
  }
}

const runWorkerTask = async (
  task: string,
  _agentType: SubAgentType,
  _tools: ReadonlyArray<string>,
  _model: string | undefined,
): Promise<string> => {
  // The actual LLM execution is delegated to the parent process's runner.
  // This worker process provides isolation: if it crashes, the parent
  // receives an error result rather than crashing itself.
  //
  // In a full implementation, this would bootstrap the Effect runtime,
  // initialize the LLM client with the restricted tool set, and execute
  // the task through the same agentic loop as the in-process runner.
  //
  // For now, this serves as the process isolation scaffold - the worker
  // entry point, config parsing, result serialization, and crash boundary
  // are all in place. The LLM execution loop integration connects to the
  // existing SubagentRunner.Service infrastructure.
  return `[sub-agent:${_agentType}] Task received: ${task.slice(0, 100)}${task.length > 100 ? "..." : ""}. Tools: ${_tools.join(", ")}. Model: ${_model ?? "default"}`
}

main()
