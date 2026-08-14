/**
 * Model-facing V2 exact-edit leaf. Relative paths resolve within the active
 * Location. Absolute paths inside that Location are accepted, while explicit
 * absolute external paths retain mutation capability through a separate
 * external_directory approval before edit approval.
 */
export * as EditTool from "./edit"

import { ToolFailure } from "@opencode-ai/llm"
import { FileDiff } from "@opencode-ai/schema/file-diff"
import { FileSystem } from "@opencode-ai/schema/filesystem"
import { createTwoFilesPatch, diffLines } from "diff"
import { Effect, Layer, Schema } from "effect"
import { makeLocationNode } from "../effect/app-node"
import { Event } from "../event"
import { FileMutation } from "../file-mutation"
import { FSUtil } from "../fs-util"
import { LocationMutation } from "../location-mutation"
import { Permission } from "../permission"
import { Presentation } from "./presentation"
import { ToolRegistry } from "./registry"
import { Tool } from "./tool"
import { Tools } from "./tools"

export const name = "edit"

export const Input = Schema.Struct({
  path: Schema.String.annotate({
    description:
      "File path to edit. Relative paths resolve within the active Location. Absolute paths inside that Location are accepted; external absolute paths require external_directory approval.",
  }),
  oldString: Schema.String.annotate({ description: "Exact text to replace" }),
  newString: Schema.String.annotate({ description: "Replacement text, which must differ from oldString" }),
  replaceAll: Schema.Boolean.pipe(Schema.optional).annotate({
    description: "Replace all exact occurrences of oldString (default false)",
  }),
})

export const Output = Schema.Struct({
  files: Schema.Array(FileDiff.Info),
  replacements: Schema.Number,
})
export type Output = typeof Output.Type

const normalizeLineEndings = (text: string) => text.replaceAll("\r\n", "\n")
const detectLineEnding = (text: string): "\n" | "\r\n" => (text.includes("\r\n") ? "\r\n" : "\n")
const convertToLineEnding = (text: string, ending: "\n" | "\r\n") =>
  ending === "\n" ? normalizeLineEndings(text) : normalizeLineEndings(text).replaceAll("\n", "\r\n")

const splitBom = (text: string) =>
  text.startsWith("\uFEFF") ? { bom: true, text: text.slice(1) } : { bom: false, text }
const joinBom = (text: string, bom: boolean) => (bom ? `\uFEFF${text}` : text)
const decodeUtf8 = (content: Uint8Array) => {
  const bom = content[0] === 0xef && content[1] === 0xbb && content[2] === 0xbf
  return { bom, content, text: new TextDecoder().decode(bom ? content.slice(3) : content) }
}

export const lineHash = (line: string): string => {
  let hash = 0
  const normalized = line.trim()
  for (let i = 0; i < normalized.length; i++) {
    hash = (hash << 5) - hash + normalized.charCodeAt(i)
    hash |= 0
  }
  return (Math.abs(hash) & 0xffff).toString(16).padStart(4, "0")
}

const HASHLINE_PATTERN = /^(?:\s*(?:\/\/|#|\/\*)\s*)?L(\d+)#([0-9a-fA-F]{4,8})\b(?::|\s*\*\/)?\s*(.*)$/

export const stripHashlines = (text: string): string =>
  normalizeLineEndings(text)
    .split("\n")
    .map((line) => {
      const match = line.match(HASHLINE_PATTERN)
      return match ? match[3] : line
    })
    .join("\n")

export const findMatchWithHashlines = (
  sourceText: string,
  oldString: string,
): { matchedOld: string; targetNew: string } | null => {
  const oldLines = normalizeLineEndings(oldString).split("\n")
  const firstLineMatch = oldLines[0]?.match(HASHLINE_PATTERN)
  if (!firstLineMatch) {
    const cleanOld = stripHashlines(oldString)
    if (cleanOld !== oldString && sourceText.includes(cleanOld)) {
      return { matchedOld: cleanOld, targetNew: cleanOld }
    }
    return null
  }

  const targetLine1Indexed = parseInt(firstLineMatch[1], 10)
  const targetHash = firstLineMatch[2].toLowerCase()
  const cleanOldLines = oldLines.map((line) => {
    const m = line.match(HASHLINE_PATTERN)
    return m ? m[3] : line
  })

  const sourceLines = normalizeLineEndings(sourceText).split("\n")
  const targetIndex = targetLine1Indexed - 1
  const candidateIndices: number[] = []

  for (let i = 0; i < sourceLines.length; i++) {
    if (lineHash(sourceLines[i]).toLowerCase() === targetHash) {
      candidateIndices.push(i)
    }
  }

  candidateIndices.sort((a, b) => Math.abs(a - targetIndex) - Math.abs(b - targetIndex))

  for (const idx of candidateIndices) {
    if (idx + cleanOldLines.length <= sourceLines.length) {
      let matches = true
      for (let j = 0; j < cleanOldLines.length; j++) {
        if (sourceLines[idx + j].trim() !== cleanOldLines[j].trim()) {
          matches = false
          break
        }
      }
      if (matches) {
        const matchedOld = sourceLines.slice(idx, idx + cleanOldLines.length).join("\n")
        return { matchedOld, targetNew: cleanOldLines.join("\n") }
      }
    }
  }

  return null
}

const countOccurrences = (content: string, search: string) => {
  if (search === "") return content.length + 1
  let count = 0
  let offset = 0
  while ((offset = content.indexOf(search, offset)) !== -1) {
    count++
    offset += search.length
  }
  return count
}

const previewLines = (value: string, prefix: "+" | "-") => {
  const lines = normalizeLineEndings(value).split("\n")
  const shown = lines.slice(0, 6).map((line) => `${prefix}${line.length > 240 ? `${line.slice(0, 240)}...` : line}`)
  if (lines.length > shown.length) shown.push(`${prefix}...`)
  return shown
}

export const toModelOutput = (output: Output, oldString: string, newString: string) =>
  [
    `Edited file successfully: ${output.files[0]?.file}`,
    `Replacements: ${output.replacements}`,
    "```diff",
    ...previewLines(oldString, "-"),
    ...previewLines(newString, "+"),
    "```",
  ].join("\n")

// Tool edits publish FileSystem.Event.Edited; FileSystemWatcher.Event.Updated is published by the V2 watcher subscription for filesystem-level changes.

const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const tools = yield* Tools.Service
    const mutation = yield* LocationMutation.Service
    const files = yield* FileMutation.Service
    const fs = yield* FSUtil.Service
    const permission = yield* Permission.Service
    const events = yield* Event.Service

    yield* tools
      .register({
        [name]: Tool.withPermission(
          Tool.make({
            description:
              "Replace exact text in one file. Relative paths resolve within the active Location. Absolute paths inside the Location are accepted. Explicit external absolute paths require external_directory approval before edit approval.",
            input: Input,
            output: Output,
            toModelOutput: ({ input, output }) => [
              { type: "text", text: toModelOutput(output, input.oldString, input.newString) },
            ],
            present: {
              call: (input) => ({
                card: "diff" as const,
                title: `Edit ${input.path}`,
                diffs: [
                  {
                    path: input.path,
                    oldText: Presentation.capCallText(input.oldString),
                    newText: Presentation.capCallText(input.newString),
                  },
                ],
                locations: [{ path: input.path }],
              }),
              result: ({ input, structured }) => {
                const files =
                  typeof structured === "object" && structured !== null
                    ? (structured as Record<string, unknown>)["files"]
                    : undefined
                const path =
                  Array.isArray(files) && typeof files[0] === "object" && files[0] !== null
                    ? (files[0] as Record<string, unknown>)["file"]
                    : undefined
                return {
                  card: "generic" as const,
                  title: `Edited ${typeof path === "string" ? path : input.path}`,
                }
              },
            },
            execute: (input, context) => {
              const unableToEdit = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
                effect.pipe(
                  Effect.mapError((error) =>
                    error instanceof FileMutation.StaleContentError
                      ? new ToolFailure({
                          message: "File changed after permission approval. Read it again before editing.",
                        })
                      : new ToolFailure({ message: `Unable to edit ${input.path}` }),
                  ),
                )

              return Effect.gen(function* () {
                const permissionSource = {
                  type: "tool" as const,
                  messageID: context.assistantMessageID,
                  callID: context.toolCallID,
                }
                if (input.oldString === input.newString) {
                  return yield* new ToolFailure({
                    message: "No changes to apply: oldString and newString are identical.",
                  })
                }
                if (input.oldString === "") {
                  return yield* new ToolFailure({
                    message: "oldString must not be empty. Use write to create or overwrite a file.",
                  })
                }

                const target = yield* unableToEdit(mutation.resolve({ path: input.path, kind: "file" }))
                const external = target.externalDirectory
                if (external) {
                  yield* unableToEdit(
                    permission.assert({
                      ...LocationMutation.externalDirectoryPermission(external),
                      sessionID: context.sessionID,
                      agent: context.agent,
                      source: permissionSource,
                    }),
                  )
                }

                yield* unableToEdit(
                  permission.assert({
                    action: "edit",
                    resources: [target.resource],
                    save: ["*"],
                    sessionID: context.sessionID,
                    agent: context.agent,
                    source: permissionSource,
                  }),
                )
                const source = decodeUtf8(yield* unableToEdit(fs.readFile(target.canonical)))
                const ending = detectLineEnding(source.text)
                let oldString = convertToLineEnding(input.oldString, ending)
                let newString = convertToLineEnding(input.newString, ending)
                let replacements = countOccurrences(source.text, oldString)

                if (replacements === 0) {
                  const hashlineMatch = findMatchWithHashlines(source.text, input.oldString)
                  if (hashlineMatch) {
                    oldString = convertToLineEnding(hashlineMatch.matchedOld, ending)
                    newString = convertToLineEnding(stripHashlines(input.newString), ending)
                    replacements = countOccurrences(source.text, oldString)
                  }
                }

                if (replacements === 0) {
                  return yield* new ToolFailure({
                    message:
                      "Could not find oldString in the file. It must match exactly, including whitespace and indentation.",
                  })
                }
                if (replacements > 1 && input.replaceAll !== true) {
                  return yield* new ToolFailure({
                    message:
                      "Found multiple exact matches for oldString. Provide more surrounding context or set replaceAll to true.",
                  })
                }

                const replaced =
                  input.replaceAll === true
                    ? source.text.replaceAll(oldString, newString)
                    : source.text.replace(oldString, newString)
                const counts = diffLines(source.text, replaced).reduce(
                  (result, item) => ({
                    additions: result.additions + (item.added ? (item.count ?? 0) : 0),
                    deletions: result.deletions + (item.removed ? (item.count ?? 0) : 0),
                  }),
                  { additions: 0, deletions: 0 },
                )
                const next = splitBom(replaced)
                const result = yield* unableToEdit(
                  files.writeIfUnchanged({
                    target,
                    expected: source.content,
                    content: joinBom(next.text, source.bom || next.bom),
                  }),
                )
                yield* events.publish(FileSystem.Event.Edited, { file: target.canonical })
                return {
                  files: [
                    {
                      file: result.resource,
                      patch: createTwoFilesPatch(result.resource, result.resource, source.text, replaced),
                      status: "modified" as const,
                      ...counts,
                    },
                  ],
                  replacements,
                } satisfies Output
              })
            },
          }),
          "edit",
        ),
      })
      .pipe(Effect.orDie)
  }),
)

export const node = makeLocationNode({
  name: "tool/edit",
  layer,
  deps: [ToolRegistry.node, LocationMutation.node, FileMutation.node, FSUtil.node, Permission.node, Event.node],
})
