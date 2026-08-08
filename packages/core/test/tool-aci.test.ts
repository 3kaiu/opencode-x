import { describe, expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import { Observability } from "@opencode-ai/observability"
import { makeObservability } from "@opencode-ai/observability/service"
import { defaultRunContext } from "@opencode-ai/observability/context/index"
import { Aci } from "../src/tool/aci"
import { testEffect } from "./lib/effect"

const it = testEffect(Aci.layer)

const LOCATION = "/repo"

describe("Aci", () => {
  test("adjudicate resolves relative paths inside the location", () => {
    const result = Aci.adjudicate({ path: "src/main.ts", location: LOCATION })
    expect(result).toEqual({
      path: "/repo/src/main.ts",
      absolute: false,
      insideLocation: true,
      allowed: true,
    })
  })

  test("adjudicate accepts absolute paths inside the location", () => {
    const result = Aci.adjudicate({ path: "/repo/src/main.ts", location: LOCATION })
    expect(result.absolute).toBe(true)
    expect(result.allowed).toBe(true)
  })

  test("adjudicate rejects traversal outside the location", () => {
    const result = Aci.adjudicate({ path: "../etc/passwd", location: LOCATION })
    expect(result.allowed).toBe(false)
    expect(result.insideLocation).toBe(false)
  })

  test("adjudicate rejects a sibling absolute path", () => {
    const result = Aci.adjudicate({ path: "/other/repo/file.ts", location: LOCATION })
    expect(result.absolute).toBe(true)
    expect(result.allowed).toBe(false)
  })

  test("adjudicate treats the location root as inside", () => {
    const result = Aci.adjudicate({ path: "/repo", location: LOCATION })
    expect(result.allowed).toBe(true)
  })

  test("classify returns category and retry hint", () => {
    const audit = Aci.auditMessage("enoent: no such file", { idempotent: true, canProbe: true })
    expect(audit.category).toBe("NotFound")
    expect(audit.hint).toEqual({ kind: "probe-first" })
    const timeout = Aci.auditMessage("operation timed out", { idempotent: false, canProbe: false })
    expect(timeout.category).toBe("Timeout")
    expect(timeout.hint).toEqual({ kind: "retry-with-changes" })
  })

  it.effect("service records adjudication metrics", () =>
    Effect.gen(function* () {
      const service = yield* Aci.Service
      const dir = `/tmp/aci-obs-test-${Date.now()}`
      const obsLayer = Layer.succeed(Observability, makeObservability(dir, defaultRunContext))
      yield* service.adjudicatePath({ path: "src/main.ts", location: LOCATION }).pipe(Effect.provide(obsLayer))
      yield* service.adjudicatePath({ path: "/other/x.ts", location: LOCATION }).pipe(Effect.provide(obsLayer))
      const option = yield* Effect.serviceOption(Observability).pipe(Effect.provide(obsLayer))
      if (option._tag === "None") throw new Error("observability layer missing")
      const snapshot = option.value.snapshot()
      expect(snapshot.counters["tool.aci.allowed"]).toBe(1)
      expect(snapshot.counters["tool.aci.relative-path"]).toBe(1)
      expect(snapshot.counters["tool.aci.external-path"]).toBe(1)
      yield* Effect.promise(() => Bun.$`rm -rf ${dir}`.then(() => undefined))
    }),
  )
})
