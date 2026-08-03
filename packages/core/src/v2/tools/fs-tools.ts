// V2 real filesystem tools (M3 §3.6): read / write / search over a workspace
// root. Path safety: every input path is resolved and must stay inside the
// root; writes are atomic (temp file + rename). Returns plain text so tool
// results render directly into the structured tool-history feedback.
export * as FsTools from "./fs-tools"

import { Effect } from "effect"
import { promises as fs } from "node:fs"
import path from "node:path"
import { tokenize } from "../memory/search"

export const MAX_READ_BYTES = 64 * 1024
export const MAX_SEARCH_FILES = 200
export const MAX_SEARCH_HITS = 30

/** Resolves a workspace-relative path and guards against escaping the root. */
export function resolveInside(root: string, p: string): string | null {
  const resolved = path.resolve(root, p)
  if (resolved === root) return resolved
  if (!resolved.startsWith(`${root}${path.sep}`)) return null
  return resolved
}

/** Reads a file with a size cap; larger files are truncated with a marker. */
export const read = Effect.fn("V2Tool.read")(function* (root: string, p: string) {
  const file = resolveInside(root, p)
  if (!file) return `error: path "${p}" escapes the workspace root`
  // Note: Effect.promise rejections are defects (catch won't see them), so the
  // promise itself swallows ENOENT/EISDIR before the effect boundary.
  const text = yield* Effect.promise(() => fs.readFile(file, "utf8").catch(() => null))
  if (text === null) return `error: cannot read ${p} (missing or not a file?)`
  const bytes = Buffer.byteLength(text, "utf8")
  if (bytes > MAX_READ_BYTES) {
    const cut = text.slice(0, MAX_READ_BYTES)
    return `${cut}\n... [truncated: ${bytes} bytes > ${MAX_READ_BYTES}]`
  }
  return text
})

/** Atomic write: temp file in the same directory, then rename. */
export const write = Effect.fn("V2Tool.write")(function* (
  root: string,
  p: string,
  content: string,
  allowedPrefixes?: ReadonlyArray<string>,
) {
  const file = resolveInside(root, p)
  if (!file) return `error: path "${p}" escapes the workspace root`
  if (allowedPrefixes) {
    const within = allowedPrefixes.some(
      (prefix) => file === path.join(root, prefix) || file.startsWith(`${path.join(root, prefix)}${path.sep}`),
    )
    if (!within) return `error: writing to "${p}" is not allowed (restricted to ${allowedPrefixes.join(", ")})`
  }
  const ok = yield* Effect.promise(() =>
    fs.mkdir(path.dirname(file), { recursive: true })
      .then(() => {
        const tmp = `${file}.tmp-${process.pid}`
        return fs.writeFile(tmp, content).then(() => fs.rename(tmp, file))
      })
      .then(
        () => true,
        () => false,
      ),
  )
  if (!ok) return `error: cannot write ${p}`
  return `ok: wrote ${Buffer.byteLength(content, "utf8")} bytes to ${p}`
})

/** Keyword line search over the workspace; hits return file:line:text. */
export const search = Effect.fn("V2Tool.search")(function* (root: string, query: string) {
  const terms = tokenize(query)
  if (terms.length === 0) return "error: empty query"
  const hits: string[] = []
  const stack: string[] = [root]
  let files = 0
  while (stack.length > 0 && files < MAX_SEARCH_FILES) {
    const dir = stack.pop()!
    let items: Array<{ readonly name: string; readonly isDirectory: () => boolean; readonly isFile: () => boolean }>
    try {
      items = (yield* Effect.promise(() => fs.readdir(dir, { withFileTypes: true }))) as unknown as Array<{
        readonly name: string
        readonly isDirectory: () => boolean
        readonly isFile: () => boolean
      }>
    } catch {
      continue
    }
    for (const item of items) {
      if (item.isDirectory()) {
        if (item.name === "node_modules" || item.name === ".git") continue
        stack.push(path.join(dir, item.name))
      } else if (item.isFile()) {
        files++
        const file = path.join(dir, item.name)
        const text = yield* Effect.promise(() => fs.readFile(file, "utf8").catch(() => null))
        if (text === null) continue
        const rel = path.relative(root, file)
        for (const [i, line] of text.split("\n").entries()) {
          if (hits.length >= MAX_SEARCH_HITS) break
          const lower = line.toLowerCase()
          if (terms.some((t) => lower.includes(t))) {
            hits.push(`${rel}:${i + 1}: ${line.trim().slice(0, 160)}`)
          }
        }
      }
    }
  }
  if (hits.length === 0) return `no hits for "${query}" in ${files} files`
  return hits.join("\n")
})
