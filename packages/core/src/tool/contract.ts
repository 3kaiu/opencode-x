// V2 tool contract extensions (M3 §3.6).
// Idempotency declaration → retry guidance; resource access declaration for
// the conflict-graph scheduler; output projection policy with head/tail
// sampling and summary hints.
export * as Contract from "./contract"

import type { ToolAccess } from "./scheduler"

export type FailureCategory = "NotFound" | "Permission" | "Timeout" | "Resource" | "Env" | "Injection" | "Unknown"

export type RetryHint =
  | { readonly kind: "retry" }                    // idempotent + transient: safe to retry as-is
  | { readonly kind: "retry-with-changes" }       // non-idempotent or semantic failure: fix args first
  | { readonly kind: "switch-tool" }              // wrong tool for the job
  | { readonly kind: "probe-first" }              // missing context: probe environment first (M2)

export interface OutputProjectionPolicy {
  readonly maxLines?: number             // default 2000
  readonly maxBytes?: number             // default 50 * 1024
  readonly truncateMode: "head" | "tail" | "head-tail"
  readonly summary?: "auto" | "none"
}

export interface V2ToolContract {
  readonly name: string
  readonly description: string
  readonly idempotent: boolean
  readonly access?: ReadonlyArray<ToolAccess>
  readonly outputProjection: OutputProjectionPolicy
}

export interface ToolFailureInfo {
  readonly category: FailureCategory
  readonly message: string
  readonly idempotent: boolean
  readonly canProbe: boolean
}

/** Derives retry guidance from failure kind + idempotency (M3 §3.6 rule 6). */
export function retryHintFor(failure: ToolFailureInfo): RetryHint {
  switch (failure.category) {
    case "Timeout":
      return failure.idempotent ? { kind: "retry" } : { kind: "retry-with-changes" }
    case "NotFound":
      return failure.canProbe ? { kind: "probe-first" } : { kind: "switch-tool" }
    case "Permission":
    case "Resource":
    case "Env":
      return { kind: "retry-with-changes" }
    case "Injection":
      return { kind: "switch-tool" }
    default:
      return failure.idempotent ? { kind: "retry" } : { kind: "retry-with-changes" }
  }
}

export const DEFAULT_PROJECTION: OutputProjectionPolicy = {
  maxLines: 2_000,
  maxBytes: 50 * 1024,
  truncateMode: "head-tail",
  summary: "auto",
}

/** head/tail sampling preview (mirrors ToolOutputStore.bound semantics). */
export function boundPreview(
  text: string,
  policy: OutputProjectionPolicy = DEFAULT_PROJECTION,
): { readonly preview: string; readonly truncated: boolean; readonly marker: string } {
  const maxLines = policy.maxLines ?? 2_000
  const maxBytes = policy.maxBytes ?? 50 * 1024
  const lines = text.split("\n")
  if (lines.length <= maxLines && Buffer.byteLength(text, "utf8") <= maxBytes) {
    return { preview: text, truncated: false, marker: "" }
  }
  const headLines = Math.ceil(maxLines / 2)
  const tailLines = maxLines - headLines
  let preview: string
  if (policy.truncateMode === "head") {
    preview = lines.slice(0, maxLines).join("\n")
  } else if (policy.truncateMode === "tail") {
    preview = lines.slice(-maxLines).join("\n")
  } else {
    preview = `${lines.slice(0, headLines).join("\n")}\n…[truncated]…\n${lines.slice(-tailLines).join("\n")}`
  }
  // Byte-safe fallback: if still over bytes, truncate by bytes.
  let bytes = Buffer.byteLength(preview, "utf8")
  if (bytes > maxBytes) {
    let chars = preview.length
    while (chars > 0 && Buffer.byteLength(preview.slice(0, chars), "utf8") > maxBytes) chars -= 16
    preview = `${preview.slice(0, chars)}\n…[byte-truncated]…`
    bytes = Buffer.byteLength(preview, "utf8")
  }
  return {
    preview,
    truncated: true,
    marker: `… output truncated; ${text.length} chars, ${bytes} bytes in preview …`,
  }
}

export const FAILURE_CATEGORIES: ReadonlyArray<FailureCategory> = [
  "NotFound", "Permission", "Timeout", "Resource", "Env", "Injection", "Unknown",
]

/** Maps an error message to a failure category via heuristics. */
export function classifyFailure(message: string): FailureCategory {
  const m = message.toLowerCase()
  if (/(not found|no such|enoent|unknown tool)/.test(m)) return "NotFound"
  if (/(denied|permission|forbidden)/.test(m)) return "Permission"
  if (/(timed? ?out|timeout)/.test(m)) return "Timeout"
  if (/(out of (memory|space)|resource|quota|limit)/.test(m)) return "Resource"
  if (/(env|environment variable|not installed|command not found)/.test(m)) return "Env"
  if (/(injection|suspicious|malicious)/.test(m)) return "Injection"
  return "Unknown"
}
