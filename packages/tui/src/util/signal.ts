import { createEffect, createSignal, on, onCleanup, type Accessor } from "solid-js"
import { createTimeline, engine } from "@opentui/core"

export function createDebouncedSignal<T>(value: T, ms: number): [Accessor<T>, (value: T) => void] {
  const [get, set] = createSignal(value)
  let timer: ReturnType<typeof setTimeout> | undefined
  const debounced = (next: T) => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = undefined
      set(() => next)
    }, ms)
  }
  onCleanup(() => {
    if (timer) clearTimeout(timer)
  })
  return [get, debounced]
}

export function createFadeIn(show: Accessor<boolean>, enabled: Accessor<boolean>) {
  const [alpha, setAlpha] = createSignal(show() ? 1 : 0)
  let revealed = show()

  createEffect(
    on([show, enabled], ([visible, animate]) => {
      if (!visible) {
        setAlpha(0)
        return
      }

      if (!animate || revealed) {
        revealed = true
        setAlpha(1)
        return
      }

      const start = performance.now()
      revealed = true
      setAlpha(0)

      const tick = () => {
        const progress = Math.min((performance.now() - start) / 160, 1)
        setAlpha(progress * progress * (3 - 2 * progress))
        if (progress < 1) return true
        return false
      }

      const timeline = createTimeline({ duration: 0, loop: true, autoplay: true })
      timeline.call(() => {
        if (!tick()) timeline.pause()
      })
      engine.register(timeline)
      onCleanup(() => {
        timeline.pause()
        engine.unregister(timeline)
      })
    }),
  )

  return alpha
}
