/**
 * Fix duplicate @opentui/keymap packages.
 *
 * Bun sometimes resolves two copies of @opentui/keymap (same version, different
 * integrity hashes). This causes TypeScript errors because `#private` fields
 * in the Keymap class are treated as distinct between copies.
 *
 * This script finds all copies and symlinks them to the first one found.
 */
import { readdir, symlink, rm, exists } from "node:fs/promises"
import { join } from "node:path"

import { resolve, dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const BUN_CACHE = join(ROOT, "node_modules", ".bun")

async function fix() {
  const entries = await readdir(BUN_CACHE, { withFileTypes: true })
  const keymapDirs = entries
    .filter((e) => e.isDirectory() && e.name.startsWith("@opentui+keymap@"))
    .map((e) => e.name)
    .sort()

  if (keymapDirs.length <= 1) {
    console.log("[dedupe-keymap] Only one keymap copy found, nothing to do.")
    return
  }

  const [primary, ...duplicates] = keymapDirs
  const primaryPath = join(BUN_CACHE, primary, "node_modules", "@opentui", "keymap")

  for (const dup of duplicates) {
    const dupPath = join(BUN_CACHE, dup, "node_modules", "@opentui", "keymap")
    await rm(dupPath, { recursive: true, force: true })
    await symlink(primaryPath, dupPath, "dir")
    console.log(`[dedupe-keymap] Linked ${dup} → ${primary}`)
  }

  console.log("[dedupe-keymap] Done.")
}

fix().catch((err) => {
  console.error("[dedupe-keymap] Failed:", err)
  process.exit(1)
})
