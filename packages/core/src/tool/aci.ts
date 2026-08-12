// V2 tool ACI audit (M3 §3.6, P3.4): failure classification with retry
// guidance. Pure helpers; the settlement boundary in `registry.ts` records the
// `tool.aci.failure` metric.
export * as Aci from "./aci"

import { classifyFailure, retryHintFor, type FailureCategory, type RetryHint, type ToolFailureInfo } from "./contract"

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
