import { expect, test } from "bun:test"
import { DEFAULT_THEMES, resolveTheme, type Theme } from "../src/theme/index"

/**
 * WCAG-style contrast regression guard for all built-in themes.
 *
 * Every theme ships both a dark and a light palette; several used to reuse the
 * dark-mode status colors (warning/success/primary) for light mode, making them
 * unreadable. This test pins the minimum ratios and lists any theme that drops
 * below, so future theme edits can't silently regress readability.
 *
 * Themes with a transparent root background (e.g. lucent-orng) depend on the
 * terminal's own background and are skipped — their contrast cannot be
 * validated statically.
 */

type R = { r: number; g: number; b: number; a: number }

function luminance(c: R): number {
  const lin = (v: number) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4))
  return 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b)
}

function blend(fg: R, bg: R): R {
  const a = fg.a
  return { r: fg.r * a + bg.r * (1 - a), g: fg.g * a + bg.g * (1 - a), b: fg.b * a + bg.b * (1 - a), a: 1 }
}

function contrast(a: R, b: R): number {
  const la = luminance(blend(a, b))
  const lb = luminance(blend(b, b))
  const [hi, lo] = la > lb ? [la, lb] : [lb, la]
  return (hi + 0.05) / (lo + 0.05)
}

type Pair = { name: string; fg: (t: Theme) => R; bg: (t: Theme) => R; minDark: number; minLight: number }

const PAIRS: Pair[] = [
  { name: "text/background", fg: (t) => t.text, bg: (t) => t.background, minDark: 4.5, minLight: 4.5 },
  { name: "text/panel", fg: (t) => t.text, bg: (t) => t.backgroundPanel, minDark: 4.5, minLight: 4.5 },
  { name: "muted/background", fg: (t) => t.textMuted, bg: (t) => t.background, minDark: 2.5, minLight: 3.0 },
  { name: "muted/panel", fg: (t) => t.textMuted, bg: (t) => t.backgroundPanel, minDark: 2.5, minLight: 3.0 },
  { name: "primary/background", fg: (t) => t.primary, bg: (t) => t.background, minDark: 3.0, minLight: 3.0 },
  { name: "success/background", fg: (t) => t.success, bg: (t) => t.background, minDark: 3.0, minLight: 3.0 },
  { name: "error/background", fg: (t) => t.error, bg: (t) => t.background, minDark: 3.0, minLight: 3.0 },
  { name: "warning/background", fg: (t) => t.warning, bg: (t) => t.background, minDark: 3.0, minLight: 3.0 },
  { name: "accent/background", fg: (t) => t.accent, bg: (t) => t.background, minDark: 3.0, minLight: 3.0 },
]

for (const mode of ["dark", "light"] as const) {
  test(`theme contrast (${mode}) stays above the readability floor`, () => {
    const failures: string[] = []
    for (const [name, json] of Object.entries(DEFAULT_THEMES)) {
      const theme = resolveTheme(json, mode)
      if (!(theme.background.a >= 1)) continue // terminal-dependent background

      for (const pair of PAIRS) {
        const fg = pair.fg(theme)
        if (!(fg.a >= 1)) continue
        const min = mode === "dark" ? pair.minDark : pair.minLight
        const ratio = contrast(fg, pair.bg(theme))
        // 0.05 tolerance absorbs 8-bit hex rounding (e.g. a computed 3.0002
        // that lands on 2.999 after quantization).
        if (ratio < min - 0.05) {
          failures.push(`${name}: ${pair.name} = ${ratio.toFixed(2)} (min ${min})`)
        }
      }
    }
    expect(failures).toEqual([])
  })
}
