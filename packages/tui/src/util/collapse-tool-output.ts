export function collapseToolOutput(
  output: string,
  maxLines: number,
  maxChars: number,
): { output: string; overflow: boolean; hiddenCount?: number } {
  const lines = output.split("\n")
  if (lines.length <= maxLines && Array.from(output).length <= maxChars) {
    return { output, overflow: false }
  }

  // Smart truncation: show first 3 lines + last 2 lines with hidden count
  const headCount = Math.max(1, Math.min(3, Math.floor(maxLines / 2)))
  const tailCount = Math.max(1, Math.min(2, maxLines - headCount - 1))
  const hiddenCount = lines.length - headCount - tailCount

  if (hiddenCount > 0) {
    const head = lines.slice(0, headCount)
    const tail = lines.slice(-tailCount)
    const marker = `… ${hiddenCount} lines hidden …`

    const result = [...head, marker, ...tail].join("\n")
    if (Array.from(result).length <= maxChars) {
      return { output: result, overflow: true, hiddenCount }
    }
  }

  // Fallback when even the smart head/marker/tail preview exceeds maxChars:
  // keep only the first maxLines and report exactly how many lines are hidden.
  const preview = lines.slice(0, maxLines).join("\n")
  const previewHidden = lines.length - maxLines
  return {
    output:
      Array.from(preview)
        .slice(0, Math.max(0, maxChars - 1))
        .join("") + "…",
    overflow: true,
    ...(previewHidden > 0 ? { hiddenCount: previewHidden } : {}),
  }
}
