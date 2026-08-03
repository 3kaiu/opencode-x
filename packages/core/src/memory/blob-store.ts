// V2 memory — blob offload (M5 §5.6, kimi blobref).
// Large tool outputs / media are stored by reference, never in the memory
// entry itself. Blobs live in a flat directory keyed by hash; the entry holds
// `{ ref: "blob:<hash>", bytes }` and content is loaded on demand.
export * as BlobStore from "./blob-store"

import { createHash } from "node:crypto"
import { promises as fs } from "node:fs"
import path from "node:path"

export interface BlobRef {
  readonly ref: string      // "blob:<sha1>"
  readonly bytes: number
}

export const BLOB_THRESHOLD = 4_096   // bytes; larger content is offloaded

export interface BlobStoreHandle {
  readonly dir: string
}

export async function openBlobStore(dir: string): Promise<BlobStoreHandle> {
  await fs.mkdir(dir, { recursive: true })
  return { dir }
}

export function isBlobRef(value: unknown): value is BlobRef {
  return typeof value === "object" && value !== null && "ref" in value && "bytes" in value
}

function hashOf(content: string): string {
  return createHash("sha1").update(content).digest("hex")
}

/** Writes content as a blob; returns the ref. Idempotent on same content. */
export async function put(store: BlobStoreHandle, content: string): Promise<BlobRef> {
  const hash = hashOf(content)
  const file = path.join(store.dir, hash)
  try {
    await fs.writeFile(file, content, { flag: "wx" })   // fail if exists (idempotent)
  } catch (e) {
    const err = e as { code?: string }
    if (err.code !== "EEXIST") throw e
  }
  return { ref: `blob:${hash}`, bytes: Buffer.byteLength(content, "utf8") }
}

export async function get(store: BlobStoreHandle, ref: BlobRef): Promise<string | null> {
  const hash = ref.ref.slice("blob:".length)
  const file = path.join(store.dir, hash)
  try {
    return await fs.readFile(file, "utf8")
  } catch {
    return null
  }
}

/**
 * Offload-aware writer: content ≥ threshold is stored as a blob ref;
 * smaller content stays inline. Returns the value to persist.
 */
export async function maybeOffload(store: BlobStoreHandle, content: string): Promise<string | BlobRef> {
  if (Buffer.byteLength(content, "utf8") < BLOB_THRESHOLD) return content
  return put(store, content)
}

/** Inverse: resolves a stored value (inline string or blob ref) to full text. */
export async function resolve(store: BlobStoreHandle, value: string | BlobRef): Promise<string> {
  if (isBlobRef(value)) return (await get(store, value)) ?? ""
  return value
}

/** GC: remove blobs older than `maxAgeMs` and not referenced by `keep` set. */
export async function cleanup(
  store: BlobStoreHandle,
  keep: ReadonlySet<string>,
  maxAgeMs = 7 * 86_400_000,
): Promise<number> {
  let removed = 0
  const files = await fs.readdir(store.dir)
  const now = Date.now()
  for (const file of files) {
    if (keep.has(file)) continue
    const full = path.join(store.dir, file)
    try {
      const stat = await fs.stat(full)
      if (now - stat.mtimeMs > maxAgeMs) {
        await fs.unlink(full)
        removed += 1
      }
    } catch {
      // raced deletion
    }
  }
  return removed
}
