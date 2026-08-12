import { createMemo } from "solid-js"
import { useData } from "../context/data"

export function useConnected() {
  const sync = useData()
  return createMemo(() =>
    sync.instance.provider.some(
      (provider) =>
        provider.id !== "opencode" || Object.values(provider.models).some((model) => model.cost?.input !== 0),
    ),
  )
}
