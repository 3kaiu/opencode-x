export * as Token from "./token"

const CHARS_PER_TOKEN = 4

function estimate(text: string): number {
  return Math.max(0, Math.round(text.length / CHARS_PER_TOKEN))
}

export const countTokens = estimate
export { estimate }