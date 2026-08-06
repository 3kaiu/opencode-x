import { expect, test } from "bun:test"
import { Locale } from "../../src/util/locale"

const width = (s: string) => Bun.stringWidth(s)

test("truncate keeps the total display width within len", () => {
  expect(Locale.truncate("hello world", 40)).toBe("hello world")
  const out = Locale.truncate("hello world", 8)
  expect(width(out)).toBeLessThanOrEqual(8)
  expect(out.endsWith("…")).toBe(true)
  // ASCII: 7 chars + ellipsis = 8 cells
  expect(Locale.truncate("hello world", 8)).toBe("hello w…")
})

test("truncate counts CJK as two cells", () => {
  const str = "这是一个很长的中文标题"
  expect(width(str)).toBe(str.length * 2)
  const out = Locale.truncate(str, 10)
  expect(width(out)).toBeLessThanOrEqual(10)
  expect(out).toBe("这是一个…") // 4 CJK (8 cells) + ellipsis (1) = 9
  // Mixed: CJK prefix must not overflow the budget
  const mixed = Locale.truncate("中文标题-title-suffix", 12)
  expect(width(mixed)).toBeLessThanOrEqual(12)
})

test("truncateLeft keeps the trailing edge and total width", () => {
  const out = Locale.truncateLeft("a very long title here", 10)
  expect(width(out)).toBeLessThanOrEqual(10)
  expect(out.startsWith("…")).toBe(true)
  expect(out.endsWith(" title here".slice(-9))).toBe(true)
  // CJK left-truncation stays within budget
  const cjk = Locale.truncateLeft("这是一个很长的中文标题", 8)
  expect(width(cjk)).toBeLessThanOrEqual(8)
  expect(cjk.startsWith("…")).toBe(true)
})

test("truncateMiddle keeps both edges within maxLength", () => {
  const out = Locale.truncateMiddle("the quick brown fox jumps over the lazy dog", 20)
  expect(width(out)).toBeLessThanOrEqual(20)
  expect(out.startsWith("the")).toBe(true)
  expect(out.endsWith("dog")).toBe(true)
  // CJK-aware middle truncation
  const cjk = Locale.truncateMiddle("前端开发工程师招聘需求说明文档", 12)
  expect(width(cjk)).toBeLessThanOrEqual(12)
  expect(cjk.includes("…")).toBe(true)
  // Short strings pass through untouched
  expect(Locale.truncateMiddle("short", 35)).toBe("short")
})

test("empty and tiny budgets degrade gracefully", () => {
  expect(Locale.truncate("hello", 1)).toBe("…")
  expect(Locale.truncateLeft("hello", 1)).toBe("…")
  expect(width(Locale.truncate("", 5))).toBe(0)
})
