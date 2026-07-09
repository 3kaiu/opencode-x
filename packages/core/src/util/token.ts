export * as Token from "./token"

function estimate(text: string): number {
  return Math.max(0, Math.round(text.length / 3))
}

export const countTokens = estimate
export { estimate }