import { Glob } from "bun"
import { statSync } from "fs"
import { join } from "path"

export interface GlobEntry {
  path: string
  size: number
  isDir: boolean
}

export function globFiles(pattern: string, root: string): GlobEntry[] | null {
  try {
    const results: GlobEntry[] = []
    const glob = new Glob(pattern)
    for (const match of glob.scanSync({ cwd: root, onlyFiles: false })) {
      const fullPath = join(root, match)
      const info = statSync(fullPath)
      results.push({ path: match, size: info.isDirectory() ? 0 : info.size, isDir: info.isDirectory() })
    }
    return results
  } catch {
    return null
  }
}
