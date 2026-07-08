/**
 * Fix duplicate packages in bun's node_modules cache.
 *
 * Bun sometimes resolves multiple copies of the same package (same version,
 * different integrity hashes). This causes TypeScript errors because private
 * fields and branded types are treated as distinct between copies.
 *
 * This script finds all duplicate copies and symlinks them to the first one found.
 */
import { readdir, symlink, rm } from "node:fs/promises"
import { resolve, dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const BUN_CACHE = join(ROOT, "node_modules", ".bun")

const PKGS = ["@opentui+keymap", "@opentui+core", "@opentui+solid", "effect", "@effect+platform", "@effect+sql"]

async function fix() {
  const entries = await readdir(BUN_CACHE, { withFileTypes: true })

  for (const prefix of PKGS) {
    const dirs = entries
      .filter((e) => e.isDirectory() && e.name.startsWith(prefix + "@"))
      .map((e) => e.name)
      .sort()

    if (dirs.length <= 1) continue

    const [primary, ...duplicates] = dirs
    const pkgName = primary.split("@").slice(0, -1).join("@")
    const parts = pkgName.startsWith("@")
      ? pkgName.split("/") // @scope/name
      : [pkgName]            // unscoped

    const primaryPath = join(BUN_CACHE, primary, "node_modules", ...parts)

    for (const dup of duplicates) {
      const dupPath = join(BUN_CACHE, dup, "node_modules", ...parts)
      await rm(dupPath, { recursive: true, force: true })
      await symlink(primaryPath, dupPath, "dir")
      console.log(`[dedupe] ${dup} → ${primary}`)
    }
  }

  console.log("[dedupe] Done.")
}

fix().catch((err) => {
  console.error("[dedupe] Failed:", err)
  process.exit(1)
})
