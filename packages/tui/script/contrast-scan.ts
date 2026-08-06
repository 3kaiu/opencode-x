// Scratch audit: WCAG contrast across all built-in themes (dark + light).
// Run: bun run packages/tui/script/contrast-scan.ts
import { DEFAULT_THEMES, resolveTheme } from "../src/theme/index"

type RGBA = { r: number; g: number; b: number; a: number }

function luminance(c: RGBA): number {
  const lin = (v: number) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4))
  return 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b)
}

function blend(fg: RGBA, bg: RGBA): RGBA {
  const a = fg.a
  return { r: fg.r * a + bg.r * (1 - a), g: fg.g * a + bg.g * (1 - a), b: fg.b * a + bg.b * (1 - a), a: 1 }
}

function contrast(a: RGBA, b: RGBA): number {
  const la = luminance(blend(a, b)) // fg over bg
  const lb = luminance(blend(b, b)) // bg itself (opaque)
  const [hi, lo] = la > lb ? [la, lb] : [lb, la]
  return (hi + 0.05) / (lo + 0.05)
}

const PAIRS: { name: string; fg: (t: any) => RGBA; bg: (t: any) => RGBA; min: number }[] = [
  { name: "text/background", fg: (t) => t.text, bg: (t) => t.background, min: 4.5 },
  { name: "text/panel", fg: (t) => t.text, bg: (t) => t.backgroundPanel, min: 4.5 },
  { name: "text/element(hover)", fg: (t) => t.text, bg: (t) => t.backgroundElement, min: 3.5 },
  { name: "muted/background", fg: (t) => t.textMuted, bg: (t) => t.background, min: 3.0 },
  { name: "muted/panel", fg: (t) => t.textMuted, bg: (t) => t.backgroundPanel, min: 3.0 },
  { name: "primary/background", fg: (t) => t.primary, bg: (t) => t.background, min: 3.0 },
  { name: "success/background", fg: (t) => t.success, bg: (t) => t.background, min: 3.0 },
  { name: "error/background", fg: (t) => t.error, bg: (t) => t.background, min: 3.0 },
  { name: "warning/background", fg: (t) => t.warning, bg: (t) => t.background, min: 3.0 },
  { name: "accent/background", fg: (t) => t.accent, bg: (t) => t.background, min: 3.0 },
]

for (const mode of ["dark", "light"] as const) {
  console.log(`\n=== ${mode.toUpperCase()} ===`)
  const rows: { theme: string; pair: string; ratio: number; min: number }[] = []
  for (const [name, json] of Object.entries(DEFAULT_THEMES)) {
    const t = resolveTheme(json, mode)
    for (const pair of PAIRS) {
      const ratio = contrast(pair.fg(t), pair.bg(t))
      if (ratio < pair.min) rows.push({ theme: name, pair: pair.name, ratio, min: pair.min })
    }
  }
  // Aggregate worst per theme
  const byTheme = new Map<string, { pair: string; ratio: number; min: number }>()
  for (const r of rows) {
    const prev = byTheme.get(r.theme)
    if (!prev || r.ratio / r.min < prev.ratio / prev.min) byTheme.set(r.theme, r)
  }
  const sorted = [...byTheme.entries()].sort((a, b) => a[1].ratio / a[1].min - b[1].ratio / b[1].min)
  for (const [theme, worst] of sorted) {
    const pct = Math.round((worst.ratio / worst.min) * 100)
    console.log(`${pct.toString().padStart(3)}%  ${theme.padEnd(20)} ${worst.pair.padEnd(22)} ${worst.ratio.toFixed(2)} (min ${worst.min})`)
  }
  console.log(`total violations: ${rows.length} (${[...byTheme.keys()].length} themes)`)
}
