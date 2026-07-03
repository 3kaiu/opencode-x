import type * as NativeTypes from "./native"
import { Effect } from "effect"

const Native = require("./index.node") as {
  executeShell: (options: NativeTypes.ShellOptions) => Promise<NativeTypes.ShellOutput>
  readFile: (path: string) => Promise<NativeTypes.FileContent>
  writeFile: (path: string, content: string) => Promise<void>
  globFiles: (pattern: string, root: string) => Promise<NativeTypes.GlobEntry[]>
  grepFiles: (
    pattern: string,
    root: string,
    includePattern?: string,
    maxMatches?: number,
  ) => Promise<NativeTypes.GrepMatch[]>
}

export type ShellOutput = NativeTypes.ShellOutput
export type ShellOptions = NativeTypes.ShellOptions
export type FileContent = NativeTypes.FileContent
export type GlobEntry = NativeTypes.GlobEntry
export type GrepMatch = NativeTypes.GrepMatch

export const executeShell = (options: ShellOptions) =>
  Effect.promise(() => Native.executeShell(options))

export const readFile = (path: string) =>
  Effect.promise(() => Native.readFile(path))

export const writeFile = (path: string, content: string) =>
  Effect.promise(() => Native.writeFile(path, content))

export const globFiles = (pattern: string, root: string) =>
  Effect.promise(() => Native.globFiles(pattern, root))

export const grepFiles = (pattern: string, root: string, includePattern?: string, maxMatches?: number) =>
  Effect.promise(() => Native.grepFiles(pattern, root, includePattern, maxMatches))
