export * as Token from "./token"

const CHARS_PER_TOKEN = 4

export const estimate = (input: string) => Math.max(0, Math.round(input.length / CHARS_PER_TOKEN))

export interface UsageSnapshot {
  inputTokens: number
  outputTokens: number
  totalTokens?: number
}

export const estimateMessages = (contents: ReadonlyArray<string>) =>
  Math.max(0, Math.round(contents.reduce((acc, content) => acc + content.length, 0) / CHARS_PER_TOKEN))

export interface MessageWithUsage {
  content: string
  usage?: UsageSnapshot
}

export const estimateContextTokens = (
  messages: ReadonlyArray<MessageWithUsage>,
  lastUsage?: UsageSnapshot,
) => {
  if (!lastUsage) {
    return estimateMessages(messages.map((m) => m.content))
  }
  const reversedIndex = Array.from(messages).reverse().findIndex((m) => m.usage !== undefined)
  const lastUsageIndex = reversedIndex >= 0 ? messages.length - 1 - reversedIndex : -1
  const startIndex = lastUsageIndex >= 0 ? lastUsageIndex + 1 : 0
  const newContents = messages.slice(startIndex).map((m) => m.content)
  return lastUsage.inputTokens + estimateMessages(newContents)
}
