import { z } from "zod"

/** @deprecated v1 plugin surface. Use `@opencode-ai/plugin/v2/*` (batch E retirement). */
export type ToolContext = {
  sessionID: string
  messageID: string
  agent: string
  /**
   * Current project directory for this session.
   * Prefer this over process.cwd() when resolving relative paths.
   */
  directory: string
  /**
   * Project worktree root for this session.
   * Useful for generating stable relative paths (e.g. path.relative(worktree, absPath)).
   */
  worktree: string
  abort: AbortSignal
  metadata(input: { title?: string; metadata?: { [key: string]: any } }): void
  ask(input: AskInput): Promise<void>
}

type AskInput = {
  permission: string
  patterns: string[]
  always: string[]
  metadata: { [key: string]: any }
}

/** @deprecated v1 plugin surface. Use `@opencode-ai/plugin/v2/*` (batch E retirement). */
export type ToolAttachment = {
  type: "file"
  mime: string
  url: string
  filename?: string
}

/** @deprecated v1 plugin surface. Use `@opencode-ai/plugin/v2/*` (batch E retirement). */
export type ToolResult =
  | string
  | {
      title?: string
      output: string
      metadata?: { [key: string]: any }
      attachments?: ToolAttachment[]
    }

/**
 * @deprecated v1 plugin surface (tool definitions registered through v1 `Hooks.tool`).
 * Superseded by the v2 Effect/Promise surfaces under `src/v2/` (`@opencode-ai/plugin/v2/effect`,
 * `@opencode-ai/plugin/v2/promise`). New plugin code must target v2; this surface is retained
 * for the opencode auth/loader bridge until batch E retires it.
 */
export function tool<Args extends z.ZodRawShape>(input: {
  description: string
  args: Args
  execute(args: z.infer<z.ZodObject<Args>>, context: ToolContext): Promise<ToolResult>
}) {
  return input
}
tool.schema = z

/** @deprecated v1 plugin surface. Use `@opencode-ai/plugin/v2/*` (batch E retirement). */
export type ToolDefinition = ReturnType<typeof tool>
