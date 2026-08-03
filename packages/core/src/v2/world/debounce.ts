// V2 world perception — event debounce (M2 §2.6).
// Coalesces bursts (npm install, git checkout) into a single batch event so
// the model is not flooded. Window-based merging with a flush timer.
export * as Debounce from "./debounce"

export interface ChangeEvent {
  readonly type: "file.changed" | "file.created" | "file.deleted" | "file.batch"
  readonly paths: ReadonlyArray<string>
  readonly seq: number
}

export interface Debouncer {
  readonly push: (type: "file.changed" | "file.created" | "file.deleted", path: string) => void
  readonly flush: () => ChangeEvent | null
  readonly pending: () => number
}

export function createDebouncer(windowMs = 500, seqRef: { readonly current: () => number }): Debouncer {
  let paths: string[] = []
  let lastType: ChangeEvent["type"] | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  let lastEmitted: ChangeEvent | null = null

  const emit = () => {
    timer = null
    if (paths.length === 0) return
    const event: ChangeEvent = {
      type: paths.length > 1 ? "file.batch" : (lastType ?? "file.changed"),
      paths: [...paths],
      seq: seqRef.current(),
    }
    paths = []
    lastType = null
    lastEmitted = event
  }

  return {
    push(type, p) {
      lastType = type
      paths.push(p)
      if (timer === null) {
        timer = setTimeout(emit, windowMs)
      }
    },
    flush() {
      if (timer !== null) {
        clearTimeout(timer)
        timer = null
      }
      emit()
      return lastEmitted
    },
    pending() {
      return paths.length
    },
  }
}
