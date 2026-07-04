import type * as NativeTypes from "./native"
import { Effect } from "effect"

const Native = require("./index.node") as {
  grepFiles: (
    pattern: string,
    root: string,
    includePattern?: string,
    maxMatches?: number,
  ) => Promise<NativeTypes.GrepMatch[]>
}

export type GrepMatch = NativeTypes.GrepMatch

export const grepFiles = (pattern: string, root: string, includePattern?: string, maxMatches?: number) =>
  Effect.promise(() => Native.grepFiles(pattern, root, includePattern, maxMatches))
