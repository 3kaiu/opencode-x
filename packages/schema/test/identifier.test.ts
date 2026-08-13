import { describe, expect, test } from "bun:test"
import { create } from "../src/identifier"

const mask = 0xffffffffffffn
const prefix = (id: string) => BigInt(`0x${id.slice(0, 12)}`)

describe("Identifier", () => {
  test("create emits fixed-length base62 strings", () => {
    for (let i = 0; i < 1000; i++) {
      const id = create()
      expect(id).toMatch(/^[0-9A-Za-z]{26}$/)
    }
  })

  test("ascending ids sort after descending ids for the same timestamp", () => {
    const ts = 1712345678901
    const asc = create(false, ts)
    const desc = create(true, ts)
    expect(desc < asc).toBe(true)
  })

  test("ascending and descending id prefixes decode to the same timestamp", () => {
    const ts = 1712345678902
    const asc = create(false, ts)
    const desc = create(true, ts)
    expect(prefix(asc)).toBe(BigInt(ts * 4096 + 1) & mask)
    expect(prefix(desc) ^ mask).toBe(BigInt(ts * 4096 + 2) & mask)
  })

  test("suffix differs between calls at the same timestamp", () => {
    const ts = 1712345678903
    const a = create(false, ts)
    const b = create(false, ts)
    expect(prefix(b)).toBe(prefix(a) + 1n)
    expect(a.slice(12)).not.toBe(b.slice(12))
  })

  test("create with a counter resets on timestamp change", () => {
    const ts = 1712345678904
    const first = create(false, ts)
    const second = create(false, ts)
    const after = create(false, ts + 1)
    expect(prefix(second)).toBe(prefix(first) + 1n)
    expect(prefix(after)).toBe(BigInt((ts + 1) * 4096 + 1) & mask)
  })
})