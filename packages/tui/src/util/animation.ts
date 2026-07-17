import { createEffect, createSignal, on, onCleanup, type Accessor } from "solid-js"
import { createTimeline, engine, type EasingFunctions } from "@opentui/core"
import { useKV } from "../context/kv"

export function useAnimationsEnabled(): Accessor<boolean> {
  const kv = useKV()
  return () => kv.get("animations_enabled", true)
}

export function createNumberTransition(
  source: Accessor<number>,
  options: { duration?: number; ease?: EasingFunctions; disabled?: Accessor<boolean> },
): Accessor<number> {
  const duration = options.duration ?? 160
  const disabled = options.disabled ?? (() => false)
  const [current, setCurrent] = createSignal(source())

  let from = source()
  let to = source()
  let start = 0

  const tick = (deltaTime: number) => {
    if (start === 0) start = deltaTime
    const elapsed = deltaTime - start
    const progress = Math.min(elapsed / duration, 1)
    const eased = progress * progress * (3 - 2 * progress)
    setCurrent(from + (to - from) * eased)
    if (progress >= 1) return false
    return true
  }

  let removeTick: (() => void) | undefined

  createEffect(
    on(source, (value) => {
      if (disabled()) {
        setCurrent(value)
        return
      }
      from = current()
      to = value
      start = 0
      removeTick?.()
      removeTick = registerFrameTick(tick)
    }),
  )

  onCleanup(() => removeTick?.())
  return current
}

function registerFrameTick(fn: (deltaTime: number) => boolean): () => void {
  let lastTime = 0
  const timeline = createTimeline({
    duration: 0,
    loop: true,
    autoplay: true,
  })
  timeline.call(() => {
    if (lastTime === 0) lastTime = performance.now()
    const dt = performance.now() - lastTime
    lastTime = performance.now()
    if (!fn(dt)) timeline.pause()
  })
  engine.register(timeline)
  return () => {
    timeline.pause()
    engine.unregister(timeline)
  }
}
