export * as GrepTool from "./grep"

import { ToolFailure } from "@opencode-ai/llm"
import { Effect, Layer, Schema } from "effect"
import path from "path"
import { makeLocationNode } from "../effect/app-node"
import { FileSystem } from "../filesystem"
import { FSUtil } from "../fs-util"
import { Global } from "../global"
import { Location } from "../location"
import { LocationMutation } from "../location-mutation"
import { Permission } from "../permission"
import { Ripgrep } from "../ripgrep"
import { RelativePath } from "../schema"
import { ToolOutputStore } from "../tool-output-store"
import { Presentation } from "./presentation"
import { ToolRegistry } from "./registry"
import { Tool } from "./tool"
import { Tools } from "./tools"

export const name = "grep"

const DEFAULT_LIMIT = 100

export const Input = Schema.Struct({
  pattern: FileSystem.GrepInput.fields.pattern.annotate({
    description: "Regex pattern to search for in file contents",
  }),
  path: RelativePath.pipe(Schema.optional).annotate({
    description: "Relative directory to search. Defaults to the active Location.",
  }),
  include: FileSystem.GrepInput.fields.include.annotate({
    description: 'File glob to include in the search (for example, "*.js" or "*.{ts,tsx}")',
  }),
  limit: FileSystem.GrepInput.fields.limit.annotate({
    description: `Maximum matches to return. Defaults to ${DEFAULT_LIMIT}.`,
  }),
})

export const Output = Schema.Array(FileSystem.Match)
type ModelOutput = typeof Output.Encoded

/** Format raw search matches into the familiar concise model output. */
export const toModelOutput = (output: ModelOutput) => {
  const lines = output.length === 0 ? ["No files found"] : [`Found ${output.length} matches`]
  let current = ""
  for (const match of output) {
    if (current !== match.entry.path) {
      if (current) lines.push("")
      current = match.entry.path
      lines.push(`${match.entry.path}:`)
    }
    lines.push(`  Line ${match.line}: ${match.text}`)
  }
  return lines.join("\n")
}

/** Grep leaf that defaults its filesystem root to the active Location. */
const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const tools = yield* Tools.Service
    const fs = yield* FSUtil.Service
    const ripgrep = yield* Ripgrep.Service
    const location = yield* Location.Service
    const permission = yield* Permission.Service
    const mutation = yield* LocationMutation.Service
    const global = yield* Global.Service

    yield* tools
      .register({
        [name]: Tool.make({
          description:
            "Search file contents by regular expression within the active Location or an absolute managed tool-output file. Use a path to narrow the search, include to filter files by glob, and limit to bound the match count. Returns concise file resources, line numbers, and bounded line previews.",
          input: Input,
          output: Output,
          toModelOutput: ({ output }) => [
            {
              type: "text",
              text: toModelOutput(
                output.map((match) => ({
                  ...match,
                  entry: { ...match.entry, path: path.resolve(location.directory, match.entry.path) },
                })),
              ),
            },
          ],
          present: {
            call: (input) => ({
              card: "generic" as const,
              title: `Search ${input.path ?? "."} for ${input.pattern}`,
              kind: "search",
              locations: [{ path: input.path ?? "." }],
            }),
            result: ({ structured }) => {
              const matches = Array.isArray(structured) ? structured : []
              const files: Array<{ path: string; matches: Array<{ lineNumber: number; line: string }> }> = []
              for (const match of matches) {
                const record = match as { entry?: { path?: string }; line?: unknown; text?: unknown }
                const path = typeof record.entry?.path === "string" ? record.entry.path : "?"
                let file = files.find((candidate) => candidate.path === path)
                if (!file) {
                  file = { path, matches: [] }
                  files.push(file)
                }
                if (typeof record.line === "number" && typeof record.text === "string")
                  file.matches.push({ lineNumber: record.line, line: record.text })
              }
              return {
                card: "search" as const,
                shape: "matches",
                files,
                truncated: false,
                total: files.reduce((total, file) => total + file.matches.length, 0),
              }
            },
          },
          execute: (input, context) =>
            Effect.gen(function* () {
              const source = {
                type: "tool" as const,
                messageID: context.assistantMessageID,
                callID: context.toolCallID,
              }
              // Relative paths must stay inside the Location; absolute paths outside it require
              // external_directory approval, except managed tool-output files the store produced.
              const target = yield* mutation.resolve({ path: input.path ?? ".", kind: "directory" })
              const external = target.externalDirectory
              if (
                external &&
                !FSUtil.contains(path.join(global.data, ToolOutputStore.MANAGED_DIRECTORY), target.canonical)
              )
                yield* permission.assert({
                  ...LocationMutation.externalDirectoryPermission(external),
                  sessionID: context.sessionID,
                  agent: context.agent,
                  source,
                })
              yield* permission.assert({
                action: name,
                resources: [input.pattern],
                save: ["*"],
                metadata: {
                  root: ".",
                  path: input.path,
                  include: input.include,
                  limit: input.limit,
                },
                sessionID: context.sessionID,
                agent: context.agent,
                source,
              })
              const info = yield* fs.stat(target.canonical).pipe(Effect.catch(() => Effect.succeed(undefined)))
              return yield* ripgrep
                .grep({
                  cwd: info?.type === "Directory" ? target.canonical : path.dirname(target.canonical),
                  pattern: input.pattern,
                  file: info?.type === "File" ? path.basename(target.canonical) : undefined,
                  include: input.include,
                  limit: input.limit ?? DEFAULT_LIMIT,
                })
                .pipe(
                  Effect.map((result) =>
                    result.map((match) =>
                      FileSystem.Match.make({
                        ...match,
                        entry: FileSystem.Entry.make({
                          ...match.entry,
                          path: RelativePath.make(
                            path.relative(
                              location.directory,
                              path.resolve(
                                info?.type === "Directory" ? target.canonical : path.dirname(target.canonical),
                                match.entry.path,
                              ),
                            ),
                          ),
                        }),
                      }),
                    ),
                  ),
                )
            }).pipe(Effect.mapError(() => new ToolFailure({ message: `Unable to grep for ${input.pattern}` }))),
        }),
      })
      .pipe(Effect.orDie)
  }),
)

export const node = makeLocationNode({
  name: "tool/grep",
  layer,
  deps: [ToolRegistry.node, FSUtil.node, Ripgrep.node, Location.node, LocationMutation.node, Global.node, Permission.node],
})
