import { Effect } from "effect"

let signal = false

export const requestCompaction = Effect.sync(() => {
  signal = true
})

export const consumeCompactionRequest = Effect.sync(() => {
  const value = signal
  signal = false
  return value
})
