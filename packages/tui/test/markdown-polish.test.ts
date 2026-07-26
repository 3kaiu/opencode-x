import { describe, expect, test } from "bun:test"
import { formatLatex, polishMarkdown } from "../src/util/markdown"

describe("formatLatex", () => {
  test("converts symbols, fractions, and text commands", () => {
    expect(formatLatex("E[X] = \\frac{1}{\\lambda} = 15 \\text{ 分钟}")).toBe("E[X] = 1/λ = 15 分钟")
    expect(formatLatex("X \\sim \\text{Exponential}(\\lambda), \\quad x \\ge 0")).toBe("X ∼ Exponential(λ), x ≥ 0")
    expect(formatLatex("P(X > s + t \\mid X > s) = P(X > t)")).toBe("P(X > s + t | X > s) = P(X > t)")
  })

  test("maps subscripts and superscripts to unicode when possible", () => {
    expect(formatLatex("0 = S_0 < S_1 < S_2 < \\cdots")).toBe("0 = S₀ < S₁ < S₂ < ⋯")
    expect(formatLatex("X_n = S_n - S_{n-1}")).toBe("Xₙ = Sₙ - Sₙ₋₁")
    expect(formatLatex("x^2 + y^{10}")).toBe("x² + y¹⁰")
    expect(formatLatex("W(t) = S_{N(t)+1} - t")).toBe("W(t) = S_(N(t)+1) - t")
    expect(formatLatex("e^{-\\lambda x}")).toBe("e^(-λ x)")
  })

  test("drops overset annotations and structural commands", () => {
    expect(formatLatex("X \\overset{\\text{i.i.d.}}{\\sim} \\text{Exponential}(\\lambda)")).toBe(
      "X ∼ Exponential(λ)",
    )
    expect(formatLatex("\\left( \\frac{a+b}{2} \\right)")).toBe("( (a+b)/2 )")
    expect(formatLatex("\\sqrt{2}")).toBe("√2")
    expect(formatLatex("\\mathbb{E}[X]")).toBe("𝔼[X]")
  })
})

describe("polishMarkdown", () => {
  test("renders display math as a code block", () => {
    const input = "前文:\n\n$$\nE[X] = \\frac{1}{\\lambda} = 15 \\text{ 分钟}\n$$\n\n后文"
    expect(polishMarkdown(input)).toBe("前文:\n\n```\nE[X] = 1/λ = 15 分钟\n```\n\n后文")
  })

  test("renders inline math as a code span", () => {
    expect(polishMarkdown("其中 $N(t)$ 是到达次数。")).toBe("其中 `N(t)` 是到达次数。")
    expect(polishMarkdown("设 $0 = S_0 < S_1 < \\cdots$ 为时刻")).toBe("设 `0 = S₀ < S₁ < ⋯` 为时刻")
    expect(polishMarkdown("间隔 \\(X_n\\) 独立")).toBe("间隔 `Xₙ` 独立")
  })

  test("leaves currency and incomplete math untouched", () => {
    expect(polishMarkdown("花了 $5 and $10 later")).toBe("花了 $5 and $10 later")
    expect(polishMarkdown("$$\nE[X] = 1")).toBe("$$\nE[X] = 1")
  })

  test("fixes emphasis delimiters between ascii punctuation and cjk", () => {
    expect(polishMarkdown("到达过程为 *泊松过程 (Poisson process)*。")).toBe(
      "到达过程为 *泊松过程 (Poisson process)\u200b*。",
    )
    expect(polishMarkdown("**加粗 (bold)**。后续")).toBe("**加粗 (bold)\u200b**。后续")
    expect(polishMarkdown("**加粗 (bold)** 后续")).toBe("**加粗 (bold)** 后续")
  })

  test("does not touch code fences or inline code", () => {
    const fenced = "```ts\nconst x = a * b // $\\lambda$\n```"
    expect(polishMarkdown(fenced)).toBe(fenced)
    expect(polishMarkdown("行内 `$x$` 保留")).toBe("行内 `$x$` 保留")
  })
})
