import { createEffect, createSignal, onCleanup, type Accessor } from "solid-js"
import { useKV } from "../../context/kv"

// Animated "..." ellipsis shown while a workspace/session is being created.
// Motion is gated behind animations_enabled; when disabled it stays at the
// full three-dot state instead of cycling.
export function useCreatingDots(creating: Accessor<boolean>): Accessor<number> {
  const kv = useKV()
  const [dots, setDots] = createSignal(3)
  createEffect(() => {
    if (!creating() || !kv.get("animations_enabled", true)) {
      setDots(3)
      return
    }
    const timer = setInterval(() => setDots((value) => (value % 3) + 1), 1000)
    onCleanup(() => clearInterval(timer))
  })
  return dots
}
