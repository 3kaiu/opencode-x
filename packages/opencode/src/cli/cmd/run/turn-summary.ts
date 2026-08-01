import * as Locale from "@/util/locale"
import type { SessionMessages } from "./session.shared"
import type { RunProvider, StreamCommit } from "./types"

export function turnSummaryCommit(input: {
  agent: string
  model: string
  duration: string
  cachePercent?: number
  messageID?: string
}): StreamCommit {
  const cache = input.cachePercent !== undefined ? ` · cache ${input.cachePercent}%` : ""
  return {
    kind: "system",
    text: `▣ ${input.agent} · ${input.model} · ${input.duration}${cache}`,
    phase: "final",
    source: "system",
    summary: {
      agent: input.agent,
      model: input.model,
      duration: input.duration,
      cachePercent: input.cachePercent,
    },
    messageID: input.messageID,
  }
}

export function messageTurnSummaryCommit(
  message: SessionMessages[number],
  providers?: RunProvider[],
): StreamCommit | undefined {
  const info = message.info
  if (info.role !== "assistant") {
    return
  }

  const completed = info.time.completed
  if (typeof completed !== "number" || completed <= info.time.created) {
    return
  }

  // V1 token accounting splits prompt tokens: input is non-cached, cache.read
  // is the cached share — DeepSeek prices cache hits 50-120x cheaper.
  const cacheRead = info.tokens?.cache?.read
  const promptTokens = cacheRead !== undefined ? cacheRead + (info.tokens?.cache?.write ?? 0) + (info.tokens?.input ?? 0) : 0
  const cachePercent = cacheRead !== undefined && cacheRead > 0 && promptTokens > 0 ? Math.round((cacheRead / promptTokens) * 100) : undefined

  const model = providers?.find((item) => item.id === info.providerID)?.models[info.modelID]?.name

  return turnSummaryCommit({
    agent: Locale.titlecase(info.agent),
    model: model ?? info.modelID,
    duration: Locale.duration(completed - info.time.created),
    cachePercent,
    messageID: info.id,
  })
}
