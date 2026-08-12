import type { BoxRenderable } from "@opentui/core"

/**
 * Renderables tagged as their own visual blocks. The sticky-bottom geometry
 * keeps separators attached to the preceding block instead of merging them
 * with whatever renders next (see the inline-tool wrap snapshots).
 */
export const alwaysSeparate = new WeakSet<BoxRenderable>()