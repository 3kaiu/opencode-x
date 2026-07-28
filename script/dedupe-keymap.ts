/**
 * Fix duplicate packages in bun's node_modules cache.
 *
 * Bun sometimes resolves multiple copies of the same package (same version,
 * different integrity hashes). This causes TypeScript errors because private
 * fields and branded types are treated as distinct between copies.
 *
 * This script finds duplicate copies in .bun cache and symlinks them to the
 * primary copy. It then scans workspace package node_modules and updates any
 * symlinks that pointed to deduped directories.
 */
import { readdir, symlink, rm, lstat, realpath } from "node:fs/promises"
import { resolve, dirname, join, relative } from "node:path"
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
    const withoutHash = primary.split("@").slice(0, -1).join("@")
    const npmName = withoutHash.replace("+", "/")
    const parts = npmName.startsWith("@") ? npmName.split("/") : [npmName]

    const primaryPath = join(BUN_CACHE, primary, "node_modules", ...parts)

    for (const dup of duplicates) {
      const dupPath = join(BUN_CACHE, dup, "node_modules", ...parts)
      try {
        const stat = await lstat(dupPath)
        if (stat.isSymbolicLink()) continue
      } catch {
        continue
      }
      await rm(dupPath, { recursive: true, force: true })
      await symlink(primaryPath, dupPath, "dir")
      console.log(`[dedupe] ${dup} → ${primary}`)

      // Also dedupe the dup's node_modules for sub-dependencies
      // (e.g. solid-js inside @opentui+solid's node_modules)
      const dupNodeModules = join(BUN_CACHE, dup, "node_modules")
      const primaryNodeModules = join(BUN_CACHE, primary, "node_modules")
      const primarySubEntries = await readdir(primaryNodeModules, { withFileTypes: true })
      for (const sub of primarySubEntries) {
        if (!sub.isSymbolicLink() && !sub.isDirectory()) continue
        const subName = sub.name
        if (subName === parts[0]) continue // skip the main package itself
        const dupSubPath = join(dupNodeModules, subName)
        const primarySubPath = join(primaryNodeModules, subName)
        try {
          const dupSubStat = await lstat(dupSubPath)
          if (dupSubStat.isSymbolicLink()) {
            // Check if target differs
            const dupTarget = await realpath(dupSubPath)
            const primaryTarget = await realpath(primarySubPath)
            if (dupTarget !== primaryTarget) {
              await rm(dupSubPath, { force: true })
              await symlink(primarySubPath, dupSubPath, sub.isDirectory() ? "dir" : "file")
              console.log(`[dedupe]   sub-dep: ${dup}/node_modules/${subName} → primary`)
            }
          }
        } catch {
          // sub-dep doesn't exist in dup, skip
        }
      }
    }
  }

  // Unify solid-js across ALL .bun cache packages to the latest version.
  // This prevents TypeScript from seeing incompatible JSX types from different
  // solid-js versions resolved through different dependency paths.
  const solidVersions = entries
    .filter((e) => e.isDirectory() && e.name.startsWith("solid-js@"))
    .map((e) => e.name)
    .sort()
  if (solidVersions.length > 1) {
    const latest = solidVersions[solidVersions.length - 1]
    const latestSolidPath = join(BUN_CACHE, latest, "node_modules", "solid-js")
    const latestWebPath = join(BUN_CACHE, latest, "node_modules", "solid-js", "web")

    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      if (entry.name.startsWith("solid-js@")) continue
      const nodeModules = join(BUN_CACHE, entry.name, "node_modules")
      try {
        await readdir(nodeModules)
      } catch {
        continue
      }
      for (const solidDep of ["solid-js"]) {
        const linkPath = join(nodeModules, solidDep)
        try {
          const stat = await lstat(linkPath)
          if (!stat.isSymbolicLink()) continue
          const target = await realpath(linkPath)
          const currentVersion = target.replace(BUN_CACHE + "/", "").split("/")[0]
          if (currentVersion !== latest && currentVersion.startsWith("solid-js@")) {
            await rm(linkPath, { force: true })
            await symlink(relative(nodeModules, latestSolidPath), linkPath, "dir")
            console.log(`[dedupe] ${entry.name}/node_modules/solid-js → ${latest}`)
          }
        } catch {
          // doesn't exist or not a symlink
        }
      }
    }
  }

  // Fix workspace symlinks that pointed to deduped directories
  const packagesDir = join(ROOT, "packages")
  const workspaceDirs = await readdir(packagesDir, { withFileTypes: true })

  for (const ws of workspaceDirs) {
    if (!ws.isDirectory()) continue
    const nodeModules = join(packagesDir, ws.name, "node_modules", "@opentui")
    try {
      await readdir(nodeModules)
    } catch {
      continue
    }

    const pkgs = await readdir(nodeModules, { withFileTypes: true })
    for (const pkg of pkgs) {
      if (!pkg.isSymbolicLink()) continue
      const linkPath = join(nodeModules, pkg.name)
      let target: string
      try {
        target = await realpath(linkPath)
      } catch {
        continue
      }

      const relToCache = relative(BUN_CACHE, target)
      if (!relToCache.startsWith("..")) {
        const cacheName = relToCache.split("/")[0]
        for (const prefix of PKGS) {
          if (!cacheName.startsWith(prefix + "@")) continue
          const allDirs = entries
            .filter((e) => e.isDirectory() && e.name.startsWith(prefix + "@"))
            .map((e) => e.name)
            .sort()
          if (allDirs.length <= 1) continue
          const [primaryDir] = allDirs
          if (cacheName !== primaryDir) {
            const primaryPath = target.replace(
              join(BUN_CACHE, cacheName),
              join(BUN_CACHE, primaryDir),
            )
            await rm(linkPath, { force: true })
            await symlink(primaryPath, linkPath, "dir")
            console.log(`[dedupe] workspace: ${ws.name}/node_modules/@opentui/${pkg.name} → primary`)
          }
        }
      }
    }

    // Fix solid-js symlinks in workspace node_modules to point to a single version
    const wsNodeModules = join(packagesDir, ws.name, "node_modules")
    for (const solidDep of ["solid-js", "solid-js/web"]) {
      try {
        const solidLink = join(wsNodeModules, ...solidDep.split("/"))
        const solidStat = await lstat(solidLink)
        if (solidStat.isSymbolicLink()) {
          const target = await realpath(solidLink)
          const solidVersions = entries
            .filter((e) => e.isDirectory() && e.name.startsWith("solid-js@"))
            .map((e) => e.name)
            .sort()
          if (solidVersions.length > 1) {
            const latest = solidVersions[solidVersions.length - 1]
            const latestPath = join(BUN_CACHE, latest, "node_modules", ...solidDep.split("/"))
            const currentCache = target.replace(BUN_CACHE + "/", "").split("/")[0]
            if (currentCache !== latest) {
              await rm(solidLink, { force: true })
              await symlink(relative(wsNodeModules, latestPath), solidLink, "dir")
              console.log(`[dedupe] workspace: ${ws.name}/node_modules/${solidDep} → ${latest}`)
            }
          }
        }
      } catch {
        // not a symlink or doesn't exist
      }
    }
  }

  console.log("[dedupe] Done.")
}

fix().catch((err) => {
  console.error("[dedupe] Failed:", err)
  process.exit(1)
})
