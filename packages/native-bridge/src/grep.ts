export interface GrepMatch {
  path: string
  line: number
  column: number
  text: string
}

interface Native {
  grepFiles: (pattern: string, root: string, include?: string, maxMatches?: number) => Promise<GrepMatch[]>
}

let native: Native | null = null

try {
  native = require("../../core/src/tool-exec/index.node") as Native
} catch {
  native = null
}

export async function grepFiles(
  pattern: string,
  root: string,
  include?: string,
  maxMatches?: number,
): Promise<GrepMatch[] | null> {
  if (!native) return null
  try {
    return await native.grepFiles(pattern, root, include, maxMatches)
  } catch {
    return null
  }
}
