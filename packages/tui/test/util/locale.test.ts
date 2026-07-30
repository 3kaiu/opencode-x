import { describe, expect, test } from "bun:test"
import { Locale } from "../../src/util/locale"

describe("Locale truncation", () => {
  test("truncateLeft respects a width budget of 1", () => {
    expect(Locale.truncateLeft("abcdef", 1)).toBe("…")
  })

  test("truncateLeft keeps the tail for larger budgets", () => {
    expect(Locale.truncateLeft("abcdef", 3)).toBe("…ef")
  })

  test("truncateLeft returns the string when it already fits", () => {
    expect(Locale.truncateLeft("ab", 3)).toBe("ab")
  })

  test("truncateMiddle respects a maxLength of 1 or 2", () => {
    expect(Locale.truncateMiddle("abcdef", 1)).toBe("…")
    expect(Locale.truncateMiddle("abcdef", 2)).toBe("a…")
  })

  test("truncateMiddle keeps both ends for larger budgets", () => {
    expect(Locale.truncateMiddle("abcdefgh", 5)).toBe("ab…gh")
  })
})
