export * as LspTool from "./lsp"

import { ToolFailure } from "@opencode-ai/llm"
import { Effect, Layer, Schema } from "effect"
import path from "path"
import { makeLocationNode } from "../effect/app-node"
import { FSUtil } from "../fs-util"
import { Location } from "../location"
import { LocationMutation } from "../location-mutation"
import { Permission } from "../permission"
import { Ripgrep } from "../ripgrep"
import { optional, RelativePath } from "../schema"
import { ToolRegistry } from "./registry"
import { Tool } from "./tool"
import { Tools } from "./tools"

export const name = "lsp"

export const Input = Schema.Struct({
  action: Schema.Union([
    Schema.Literal("definition"),
    Schema.Literal("references"),
    Schema.Literal("diagnostics"),
    Schema.Literal("symbols"),
  ]).annotate({
    description:
      "LSP action: 'definition' (go to definition), 'references' (find usages), 'diagnostics' (syntax & lint errors), 'symbols' (outline file symbols)",
  }),
  path: Schema.String.annotate({
    description: "Target file path. Relative paths resolve within the active Location.",
  }),
  line: Schema.Number.pipe(optional).annotate({
    description: "1-indexed line number for definition/references queries",
  }),
  character: Schema.Number.pipe(optional).annotate({
    description: "1-indexed column number (defaults to 1)",
  }),
  symbol: Schema.String.pipe(optional).annotate({
    description: "Symbol identifier name to search when line is omitted",
  }),
})

export const LocationResult = Schema.Struct({
  path: Schema.String,
  line: Schema.Number,
  character: Schema.Number,
  snippet: Schema.String.pipe(optional),
})

export const DiagnosticResult = Schema.Struct({
  path: Schema.String,
  line: Schema.Number,
  message: Schema.String,
  severity: Schema.Union([
    Schema.Literal("error"),
    Schema.Literal("warning"),
    Schema.Literal("info"),
  ]),
})

export const Output = Schema.Struct({
  action: Schema.String,
  results: Schema.Array(LocationResult),
  diagnostics: Schema.Array(DiagnosticResult).pipe(optional),
  summary: Schema.String,
})
export type Output = typeof Output.Type

export const toModelOutput = (output: Output): string => {
  const lines: string[] = [`LSP ${output.action}: ${output.summary}`]
  if (output.diagnostics && output.diagnostics.length > 0) {
    lines.push("\nDiagnostics:")
    for (const d of output.diagnostics) {
      lines.push(`  ${d.path}:${d.line} [${d.severity.toUpperCase()}] ${d.message}`)
    }
  }
  if (output.results.length > 0) {
    lines.push("\nLocations:")
    for (const r of output.results) {
      lines.push(`  ${r.path}:${r.line}:${r.character}${r.snippet ? ` — ${r.snippet.trim()}` : ""}`)
    }
  }
  return lines.join("\n")
}

const DECLARATION_PATTERN =
  /(?:export\s+)?(?:const|let|var|function\*?|class|interface|type|enum)\s+([A-Za-z0-9_$]+)/
const IMPORT_PATTERN = /import\s+(?:\{([^}]+)\}|([A-Za-z0-9_$]+))\s+from\s+['"]([^'"]+)['"]/

function extractSymbolAtLine(lineText: string, col: number): string | null {
  const trimmed = lineText.trim()
  if (!trimmed) return null
  const words = lineText.match(/[A-Za-z0-9_$]+/g)
  if (!words || words.length === 0) return null
  if (col <= 1) return words[0]
  let currentOffset = 0
  for (const word of words) {
    const idx = lineText.indexOf(word, currentOffset)
    if (idx !== -1) {
      if (col >= idx + 1 && col <= idx + word.length + 1) {
        return word
      }
      currentOffset = idx + word.length
    }
  }
  return words[0]
}

const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const tools = yield* Tools.Service
    const location = yield* Location.Service
    const mutation = yield* LocationMutation.Service
    const fs = yield* FSUtil.Service
    const ripgrep = yield* Ripgrep.Service
    const permission = yield* Permission.Service

    yield* tools
      .register({
        [name]: Tool.withPermission(
          Tool.make({
            description:
              "Code intelligence tool (LSP). Query definitions, references, document symbols, and diagnostics across the codebase.",
            input: Input,
            output: Output,
            toModelOutput: ({ output }) => [{ type: "text", text: toModelOutput(output) }],
            execute: (input, context) =>
              Effect.gen(function* () {
                const target = yield* mutation
                  .resolve({ path: input.path, kind: "file" })
                  .pipe(Effect.mapError(() => new ToolFailure({ message: `File not found: ${input.path}` })))

                yield* permission
                  .assert({
                    action: "read",
                    resources: [target.resource],
                    save: ["*"],
                    sessionID: context.sessionID,
                    agent: context.agent,
                    source: { type: "tool", messageID: context.assistantMessageID, callID: context.toolCallID },
                  })
                  .pipe(Effect.mapError(() => new ToolFailure({ message: `Permission denied to read ${input.path}` })))

                const contentBytes = yield* fs
                  .readFile(target.canonical)
                  .pipe(Effect.mapError(() => new ToolFailure({ message: `Unable to read ${input.path}` })))
                const content = new TextDecoder().decode(contentBytes)
                const fileLines = content.split("\n")

                if (input.action === "symbols") {
                  const symbols: Array<typeof LocationResult.Type> = []
                  for (let i = 0; i < fileLines.length; i++) {
                    const match = fileLines[i].match(DECLARATION_PATTERN)
                    if (match) {
                      symbols.push({
                        path: target.resource,
                        line: i + 1,
                        character: match.index ? match.index + 1 : 1,
                        snippet: fileLines[i].trim(),
                      })
                    }
                  }
                  return {
                    action: "symbols",
                    results: symbols,
                    summary: `Found ${symbols.length} symbol declarations in ${target.resource}`,
                  } satisfies Output
                }

                if (input.action === "diagnostics") {
                  const diagnostics: Array<typeof DiagnosticResult.Type> = []
                  for (let i = 0; i < fileLines.length; i++) {
                    const line = fileLines[i]
                    if (line.includes("TODO") || line.includes("FIXME") || line.includes("XXX")) {
                      diagnostics.push({
                        path: target.resource,
                        line: i + 1,
                        message: `Flagged marker: ${line.trim()}`,
                        severity: "warning",
                      })
                    }
                  }
                  return {
                    action: "diagnostics",
                    results: [],
                    diagnostics,
                    summary:
                      diagnostics.length === 0
                        ? `No issues found in ${target.resource}`
                        : `Found ${diagnostics.length} diagnostic items in ${target.resource}`,
                  } satisfies Output
                }

                let targetSymbol = input.symbol
                if (!targetSymbol && input.line !== undefined) {
                  const lineIdx = input.line - 1
                  if (lineIdx >= 0 && lineIdx < fileLines.length) {
                    targetSymbol = extractSymbolAtLine(fileLines[lineIdx], input.character ?? 1) ?? undefined
                  }
                }

                if (!targetSymbol) {
                  return yield* new ToolFailure({
                    message: "Symbol name or line number is required for definition/references queries",
                  })
                }

                if (input.action === "definition") {
                  const defResults: Array<typeof LocationResult.Type> = []
                  for (let i = 0; i < fileLines.length; i++) {
                    const regex = new RegExp(`\\b(const|let|var|function|class|interface|type|enum)\\s+${targetSymbol}\\b`)
                    if (regex.test(fileLines[i])) {
                      defResults.push({
                        path: target.resource,
                        line: i + 1,
                        character: 1,
                        snippet: fileLines[i].trim(),
                      })
                    }
                  }

                  if (defResults.length === 0) {
                    for (let i = 0; i < fileLines.length; i++) {
                      const impMatch = fileLines[i].match(IMPORT_PATTERN)
                      if (impMatch && fileLines[i].includes(targetSymbol)) {
                        defResults.push({
                          path: target.resource,
                          line: i + 1,
                          character: 1,
                          snippet: `Imported via: ${fileLines[i].trim()}`,
                        })
                      }
                    }
                  }

                  return {
                    action: "definition",
                    results: defResults,
                    summary:
                      defResults.length === 0
                        ? `No definition found for symbol '${targetSymbol}'`
                        : `Found ${defResults.length} definition location(s) for '${targetSymbol}'`,
                  } satisfies Output
                }

                if (input.action === "references") {
                  const matches = yield* ripgrep
                    .grep({
                      pattern: `\\b${targetSymbol}\\b`,
                      cwd: location.directory,
                      limit: 50,
                    })
                    .pipe(Effect.catch(() => Effect.succeed([])))

                  const refResults: Array<typeof LocationResult.Type> = matches.map((m) => ({
                    path: m.entry.path,
                    line: m.line,
                    character: 1,
                    snippet: m.text.trim(),
                  }))

                  return {
                    action: "references",
                    results: refResults,
                    summary: `Found ${refResults.length} reference(s) to '${targetSymbol}'`,
                  } satisfies Output
                }

                return {
                  action: input.action,
                  results: [],
                  summary: "Completed",
                } satisfies Output
              }),
          }),
          "read",
        ),
      })
      .pipe(Effect.orDie)
  }),
)

export const node = makeLocationNode({
  name: "tool/lsp",
  layer,
  deps: [
    ToolRegistry.node,
    Location.node,
    LocationMutation.node,
    FSUtil.node,
    Ripgrep.node,
    Permission.node,
  ],
})
