import { describe, expect, test } from "bun:test"
import { reasoningSummary } from "../../../src/context/thinking"

describe("reasoningSummary", () => {
  test("extracts a leading summary title and leaves markdown body", () => {
    expect(reasoningSummary("**Continuing Quality Review**\n\nDetails.\n\n**Next section**\n\nMore.")).toEqual({
      title: "Continuing Quality Review",
      body: "Details.\n\n**Next section**\n\nMore.",
    })
  })

  test("extracts a completed title before its streamed body arrives", () => {
    expect(reasoningSummary("**Continuing Quality Review**")).toEqual({
      title: "Continuing Quality Review",
      body: "",
    })
  })

  test("preserves markdown-significant indentation in the extracted body", () => {
    expect(reasoningSummary("**Continuing Quality Review**\n\n    const value = true\n")).toEqual({
      title: "Continuing Quality Review",
      body: "    const value = true",
    })
  })

  test("previews ordinary leading bold content as a prose title", () => {
    expect(reasoningSummary("**Important:** keep this in the body.")).toEqual({
      title: "Important: keep this in the body.",
      body: "**Important:** keep this in the body.",
    })
  })

  test("leaves content without a leading title in its body", () => {
    expect(reasoningSummary("Details only.")).toEqual({ title: "Details only.", body: "Details only." })
  })

  test("previews DeepSeek-style prose reasoning from its first line", () => {
    expect(
      reasoningSummary(
        "Let me trace how the session runner assembles the request.\n\nA few things to verify: the tool schema order, the system prompt, and the reasoning echo.",
      ),
    ).toEqual({
      title: "Let me trace how the session runner assembles the request.",
      body: "Let me trace how the session runner assembles the request.\n\nA few things to verify: the tool schema order, the system prompt, and the reasoning echo.",
    })
  })

  test("strips markdown decorations from the prose preview", () => {
    expect(reasoningSummary("## Approach\nFirst, check the cache fields.\n\nThen verify.")).toEqual({
      title: "Approach",
      body: "## Approach\nFirst, check the cache fields.\n\nThen verify.",
    })
    expect(reasoningSummary("- Investigate the failing test\n- Fix it")).toEqual({
      title: "Investigate the failing test",
      body: "- Investigate the failing test\n- Fix it",
    })
  })

  test("truncates long prose previews at a word boundary", () => {
    const longLine =
      "Analyzing the interplay between the streamed usage payload and the cache accounting pipeline. ".repeat(2)
    const result = reasoningSummary(longLine)
    expect(result.title?.length).toBeLessThanOrEqual(61)
    expect(result.title?.endsWith("…")).toBe(true)
    expect(result.title).toBe("Analyzing the interplay between the streamed usage payload…")
  })
})
