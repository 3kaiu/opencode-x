import { Context, Effect, Exit, Layer, Option, Tracer } from "effect"
import type { RunContext } from "../context"

export type SpanOptions = Parameters<Tracer.Tracer["span"]>[0]

export interface TracerOptions {
  readonly enabled: () => boolean
  readonly emit: (line: object) => void
}

function spanAttributes(map: ReadonlyMap<string, unknown>) {
  const out: Record<string, unknown> = {}
  for (const [key, value] of map) out[key] = value
  return out
}

function replacer(_key: string, value: unknown) {
  if (typeof value === "bigint") return String(value)
  if (value instanceof Map) return Object.fromEntries(value)
  if (value instanceof Error) return { name: value.name, message: value.message, stack: value.stack }
  if (typeof value === "function") return "[Function]"
  return value
}

let spanCounter = 0

class FileSpan implements Tracer.Span {
  readonly _tag = "Span" as const
  readonly name: string
  readonly spanId: string
  readonly traceId: string
  readonly parent: Option.Option<Tracer.AnySpan>
  readonly annotations: Context.Context<never>
  readonly links: readonly Tracer.SpanLink[] = []
  readonly sampled: boolean
  readonly kind: Tracer.SpanKind
  readonly attributes = new Map<string, unknown>()
  private readonly startMs = performance.now()
  private _status: Tracer.SpanStatus
  private ended = false

  constructor(
    readonly options: SpanOptions,
    readonly opts: TracerOptions,
  ) {
    this.name = options.name
    this.parent = options.parent
    this.annotations = options.annotations
    this.sampled = options.sampled
    this.kind = options.kind
    const parent = options.parent._tag === "Some" ? options.parent.value : undefined
    this.traceId = parent?.traceId ?? `trace-${process.pid}-${Date.now()}`
    this.spanId = `span-${process.pid}-${++spanCounter}`
    this._status = { _tag: "Started", startTime: options.startTime }
  }

  get status() {
    return this._status
  }

  end(endTime: bigint, exit: Exit.Exit<unknown, unknown>) {
    if (this.ended) return
    this.ended = true
    this._status = { _tag: "Ended", startTime: this._status.startTime, endTime, exit }
    if (!this.opts.enabled()) return
    const line = {
      traceId: this.traceId,
      spanId: this.spanId,
      parentSpanId: this.parent._tag === "Some" ? this.parent.value.spanId : undefined,
      name: this.name,
      kind: this.kind,
      durationMs: Number((performance.now() - this.startMs).toFixed(3)),
      attributes: spanAttributes(this.attributes),
      exit: exit._tag === "Failure" ? { _tag: "Failure", cause: String(exit.cause) } : { _tag: "Success" },
    }
    this.opts.emit(line)
  }

  attribute(key: string, value: unknown) {
    this.attributes.set(key, value)
  }

  event(_name: string, _startTime: bigint, _attributes?: Record<string, unknown>) {}

  addLinks(links: readonly Tracer.SpanLink[]) {
    ;(this.links as Tracer.SpanLink[]).push(...links)
  }
}

class NoOpSpan implements Tracer.Span {
  readonly _tag = "Span" as const
  readonly name = ""
  readonly spanId = ""
  readonly traceId = ""
  readonly parent: Option.Option<Tracer.AnySpan> = Option.none()
  readonly annotations: Context.Context<never> = Context.empty()
  readonly links: readonly Tracer.SpanLink[] = []
  readonly sampled = false
  readonly kind = "internal"
  readonly attributes = new Map<string, unknown>()
  readonly status: Tracer.SpanStatus = { _tag: "Started", startTime: 0n }

  end() {}
  attribute(_key: string, _value: unknown) {}
  event(_name: string, _startTime: bigint, _attributes?: Record<string, unknown>) {}
  addLinks(_links: readonly Tracer.SpanLink[]) {}
}

const noOpSpan = new NoOpSpan()

export function makeTracer(opts: TracerOptions): Tracer.Tracer {
  return {
    span(options) {
      if (!opts.enabled()) return noOpSpan
      return new FileSpan(options, opts)
    },
  }
}

export function layer(opts: TracerOptions) {
  return Layer.succeed(Tracer.Tracer, makeTracer(opts))
}
