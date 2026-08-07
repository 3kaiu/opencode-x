// Dev-only file span exporter.
//
// Effect.withSpan instruments the whole pipeline (tools, session runs, npm,
// instance bootstrap, permissions, ...), but the default Tracer discards the
// spans. This layer replaces the Tracer service and persists each ended span
// as one JSONL line under ~/.local/share/opencode/log/trace/<pid>-<ts>.jsonl
// so the full call tree (name, duration, attributes, parent span) can be
// profiled offline.
//
// Enable with OPENCODE_TRACE_FILE=1. Writing is fire-and-forget and guarded so
// tracing never breaks the app.
import fs from "fs"
import path from "path"
import { Context, Effect, Exit, Layer, Option, Tracer } from "effect"
import { Global } from "../global"

type SpanOptions = Parameters<Tracer.Tracer["span"]>[0]

function spanAttributes(map: ReadonlyMap<string, unknown>) {
  const out: Record<string, unknown> = {}
  for (const [key, value] of map) {
    out[key] = value
  }
  return out
}

function replacer(_key: string, value: unknown) {
  if (typeof value === "bigint") return String(value)
  if (value instanceof Map) return Object.fromEntries(value)
  if (value instanceof Error) return { name: value.name, message: value.message, stack: value.stack }
  if (typeof value === "function") return "[Function]"
  return value
}

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

  constructor(readonly options: SpanOptions) {
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
    // Only persist when tracing is enabled; the in-memory FileSpan otherwise
    // behaves exactly like the default NativeSpan (no I/O, no side effects).
    if (!process.env.OPENCODE_TRACE_FILE) return
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
    try {
      fs.appendFileSync(traceFile(), JSON.stringify(line, replacer) + "\n")
    } catch {
      // never let tracing break the app
    }
  }

  attribute(key: string, value: unknown) {
    this.attributes.set(key, value)
  }

  event(_name: string, _startTime: bigint, _attributes?: Record<string, unknown>) {}

  addLinks(links: readonly Tracer.SpanLink[]) {
    ;(this.links as Tracer.SpanLink[]).push(...links)
  }
}

let spanCounter = 0

function makeTracer(): Tracer.Tracer {
  return {
    span(options) {
      return new FileSpan(options)
    },
  }
}

let traceFilePath: string | undefined

function traceFile() {
  if (!traceFilePath) {
    const dir = path.join(Global.Path.log, "trace")
    fs.mkdirSync(dir, { recursive: true })
    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z")
    traceFilePath = path.join(dir, `${stamp}-${process.pid}.jsonl`)
  }
  return traceFilePath
}

// Always provide the Tracer so Effect.withSpan spans can be persisted; the
// FileSpan writes nothing unless OPENCODE_TRACE_FILE is set, so production
// overhead is limited to the same in-memory span the default NativeSpan uses.
export const layer = Layer.succeed(Tracer.Tracer, makeTracer())
