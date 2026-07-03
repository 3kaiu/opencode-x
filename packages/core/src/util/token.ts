export * as Token from "./token"

const CHARS_PER_TOKEN = 4

let rustEstimate: ((text: string) => number) | null = null
let fallbackEstimate: ((text: string) => number) | null = null
let initPromise: Promise<void> | null = null

async function tryInitNative(): Promise<void> {
  // Try Rust tiktoken first (most accurate)
  try {
    const { countTokensEstimate } = require("./index.node") as {
      countTokensEstimate: (text: string) => number
    }
    rustEstimate = countTokensEstimate
    return
  } catch {
    rustEstimate = null
  }

  // Fall back to Zig WASM (fast, UTF-8 code point count)
  try {
    const { initWasm: loadWasm, countTokens } = await import(
      /* @vite-ignore */ "../../../../natives/token-counter/src/loader"
    )
    await loadWasm()
    fallbackEstimate = countTokens
  } catch {
    fallbackEstimate = null
  }
}

export const estimate = (input: string): number => {
  if (!initPromise) {
    initPromise = tryInitNative().catch(() => {})
  }
  if (rustEstimate) return rustEstimate(input)
  if (fallbackEstimate) return fallbackEstimate(input)
  return Math.max(0, Math.round(input.length / CHARS_PER_TOKEN))
}