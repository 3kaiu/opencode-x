// V2 tool ACI audit (M3 §3.6, P3.4).
// Path adjudication (mandatory absolute paths inside the active Location) and
// failure classification with retry guidance. Reuses `contract.ts` pure
// functions and adds the observability-backed audit service.
export * as Aci from "./aci"

import { Context, Effect, Layer } from "effect"
import * as Option from "effect/Option"
import { isAbsolute, resolve, sep } from "path"
import { Observability } from "@opencode-ai/observability"
import {
  classifyFailure,
  retryHintFor,
  type FailureCategory,
  type RetryHint,
  type ToolFailureInfo,
} from "./contract"

export interface PathAdjudication {
  readonly path: string
  readonly absolute: boolean
  /** Inside the active Location (resolved path shares the Location prefix). */
  readonly insideLocation: boolean
  readonly allowed: boolean
}

/** Resolves a tool argument path; relative paths resolve within `location`. */
export function adjudicate(input: { readonly path: string; readonly location: string }): PathAdjudication {
  const absolute = isAbsolute(input.path)
  const resolved = resolve(input.location, input.path)
  const insideLocation =
    resolved === input.location ||
    resolved.startsWith(input.location.endsWith(sep) ? input.location : `${input.location}${sep}`)
  return {
    path: resolved,
    absolute,
    insideLocation,
    allowed: insideLocation,
  }
}

export interface FailureAudit {
  readonly category: FailureCategory
  readonly hint: RetryHint
}

export function auditFailure(failure: ToolFailureInfo): FailureAudit {
  return { category: failure.category, hint: retryHintFor(failure) }
}

export function auditMessage(
  message: string,
  info: { readonly idempotent: boolean; readonly canProbe: boolean },
): FailureAudit {
  return auditFailure({ message, ...info, category: classifyFailure(message) })
}

export interface Interface {
  readonly adjudicatePath: (input: { readonly path: string; readonly location: string }) => Effect.Effect<PathAdjudication>
  readonly classify: (failure: ToolFailureInfo) => Effect.Effect<FailureAudit>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Tool/Aci") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const record = (name: string, labels: Record<string, string>) =>
      Effect.gen(function* () {
        const observability = Option.getOrUndefined(yield* Effect.serviceOption(Observability))
        observability?.record("counter", name, labels, 1)
      })

    const adjudicatePath = Effect.fn("Aci.adjudicatePath")(function* (input: {
      readonly path: string
      readonly location: string
    }) {
      const result = adjudicate(input)
      if (!result.absolute) yield* record("tool.aci.relative-path", {})
      if (!result.allowed) {
        yield* record("tool.aci.external-path", {})
      } else {
        yield* record("tool.aci.allowed", {})
      }
      return result
    })

    const classify = Effect.fn("Aci.classify")(function* (failure: ToolFailureInfo) {
      const audit = auditFailure(failure)
      yield* record("tool.aci.failure", { category: audit.category })
      return audit
    })

    return Service.of({ adjudicatePath, classify })
  }),
)
