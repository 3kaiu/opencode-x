export * as Token from "./token"

const CHARS_PER_TOKEN = 4

let wasmEstimate: ((text: string) => number) | null = null
let initPromise: Promise<void> | null = null

async function tryInitWasm(): Promise<void> {
  try {
    const { initWasm: loadWasm, countTokens } = await import(
      /* @vite-ignore */ "../../natives/token-counter/src/loader"
    )
    await loadWasm()
    wasmEstimate = countTokens
  } catch {
    wasmEstimate = null
  }
}

export const estimate = (input: string): number => {
  if (!initPromise) {
    initPromise = tryInitWasm().catch(() => {})
  }
  if (wasmEstimate) return wasmEstimate(input)
  return Math.max(0, Math.round(input.length / CHARS_PER_TOKEN))
}
