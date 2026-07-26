// Best-effort polishing of LLM markdown for terminal rendering.
//
// - Converts LaTeX math ($...$, $$...$$, \(...\), \[...\]) into readable
//   Unicode text; inline math becomes a code span, display math a code block.
// - Inserts zero-width spaces around emphasis delimiters that sit between
//   ASCII punctuation and CJK text. tree-sitter-markdown_inline only treats
//   ASCII as punctuation for flanking rules, so `(bold)**。` never closes and
//   the raw asterisks leak into the output.
//
// Code fences and inline code spans are left untouched.
export function polishMarkdown(text: string): string {
  return splitCode(text)
    .map((segment) => (segment.code ? segment.text : fixEmphasis(convertMath(segment.text))))
    .join("")
}

const CODE_REGION = /```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)|``[^`\n](?:[^`\n]|`[^`\n])*?``|`[^`\n]+`/g

function splitCode(text: string) {
  const segments: { code: boolean; text: string }[] = []
  let last = 0
  for (const match of text.matchAll(CODE_REGION)) {
    if (match.index > last) segments.push({ code: false, text: text.slice(last, match.index) })
    segments.push({ code: true, text: match[0] })
    last = match.index + match[0].length
  }
  if (last < text.length) segments.push({ code: false, text: text.slice(last) })
  return segments
}

// ASCII punctuation excluding * and _ so a delimiter run is never split.
const ASCII_PUNCT = "[!-)+-./:-@\\[-^`{-~]"
const EMPHASIS_AFTER_PUNCT = new RegExp(`(${ASCII_PUNCT})([*_]{1,3})(?=[^\\x00-\\x7F])`, "g")

function fixEmphasis(text: string): string {
  return text.replace(EMPHASIS_AFTER_PUNCT, "$1\u200b$2")
}

const DISPLAY_DOLLAR = /^([ \t]*)\$\$([\s\S]*?)\$\$[ \t]*$/gm
const DISPLAY_BRACKET = /^([ \t]*)\\\[([\s\S]*?)\\\][ \t]*$/gm
const INLINE_PAREN = /\\\(([^\n]+?)\\\)/g
const INLINE_DOLLAR = /\$([^\s$](?:[^$\n]*?[^\s$])?)\$/g

function convertMath(text: string): string {
  return text
    .replace(DISPLAY_DOLLAR, displayBlock)
    .replace(DISPLAY_BRACKET, displayBlock)
    .replace(INLINE_PAREN, (_, tex) => "`" + formatLatex(tex) + "`")
    .replace(INLINE_DOLLAR, (match, tex) => (isMathy(tex) ? "`" + formatLatex(tex) + "`" : match))
}

function displayBlock(_: string, indent: string, tex: string): string {
  const body = formatLatex(tex)
    .split("\n")
    .map((line) => indent + line.trim())
    .join("\n")
  return `${indent}\`\`\`\n${body}\n${indent}\`\`\``
}

// Heuristic to skip currency like "$5 and $10" while keeping "$N(t)$".
function isMathy(tex: string): boolean {
  return /[\\^_{}=<>]/.test(tex) || /^[A-Za-z]/.test(tex)
}

export function formatLatex(tex: string): string {
  return renderTex(tex)
    .replace(/[ \t]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .trim()
}

function renderTex(src: string): string {
  let out = ""
  let i = 0
  while (i < src.length) {
    const ch = src[i]
    if (ch === "\\") {
      const command = readCommand(src, i)
      out += command.text
      i = command.next
      continue
    }
    if (ch === "^" || ch === "_") {
      const arg = readArgument(src, i + 1)
      out += mapScript(ch, renderTex(arg.content))
      i = arg.next
      continue
    }
    if (ch === "{") {
      const group = readGroup(src, i)
      out += renderTex(group.content)
      i = group.next
      continue
    }
    if (ch === "}" || ch === "&") {
      out += ch === "&" ? " " : ""
      i++
      continue
    }
    out += ch
    i++
  }
  return out
}

function readCommand(src: string, start: number): { text: string; next: number } {
  const name = /^[a-zA-Z]+/.exec(src.slice(start + 1))?.[0]
  if (!name) {
    const ch = src[start + 1] ?? ""
    if (ch === "\\") return { text: "\n", next: start + 2 }
    if (ch === "," || ch === ";" || ch === ":" || ch === " ") return { text: " ", next: start + 2 }
    if (ch === "!") return { text: "", next: start + 2 }
    return { text: ch, next: start + 2 }
  }
  const next = start + 1 + name.length
  const symbol = SYMBOLS[name]
  if (symbol !== undefined) return { text: symbol, next }
  if (name === "frac" || name === "dfrac" || name === "tfrac") {
    const a = readArgument(src, next)
    const b = readArgument(src, a.next)
    return { text: `${wrapOperand(renderTex(a.content))}/${wrapOperand(renderTex(b.content))}`, next: b.next }
  }
  if (name === "sqrt") {
    const index = readOptional(src, next)
    const arg = readArgument(src, index.next)
    const degree = index.content ? mapChars(renderTex(index.content), SUPERSCRIPT) || "" : ""
    return { text: `${degree}√${wrapOperand(renderTex(arg.content))}`, next: arg.next }
  }
  if (TEXT_COMMANDS.has(name)) {
    const arg = readArgument(src, next)
    return { text: renderTex(arg.content), next: arg.next }
  }
  if (name === "mathbb") {
    const arg = readArgument(src, next)
    const content = renderTex(arg.content)
    return { text: mapChars(content, BLACKBOARD) ?? content, next: arg.next }
  }
  if (name === "overset" || name === "underset" || name === "stackrel") {
    const annotation = readArgument(src, next)
    const base = readArgument(src, annotation.next)
    return { text: renderTex(base.content), next: base.next }
  }
  if (ACCENTS[name]) {
    const arg = readArgument(src, next)
    const content = renderTex(arg.content)
    return { text: content.length === 1 ? content + ACCENTS[name] : content, next: arg.next }
  }
  if (name === "left" || name === "right" || name === "big" || name === "Big" || name === "bigg" || name === "Bigg") {
    // \left. and \right. are invisible delimiters
    if (src[next] === ".") return { text: "", next: next + 1 }
    return { text: "", next }
  }
  if (name === "begin" || name === "end") {
    const arg = readArgument(src, next)
    return { text: "", next: arg.next }
  }
  if (SKIP_COMMANDS.has(name)) return { text: "", next }
  return { text: name, next }
}

function readGroup(src: string, start: number): { content: string; next: number } {
  let depth = 0
  for (let i = start; i < src.length; i++) {
    if (src[i] === "\\") {
      i++
      continue
    }
    if (src[i] === "{") depth++
    if (src[i] === "}") {
      depth--
      if (depth === 0) return { content: src.slice(start + 1, i), next: i + 1 }
    }
  }
  return { content: src.slice(start + 1), next: src.length }
}

// Reads a command argument: a braced group, a \command token, or one char.
function readArgument(src: string, start: number): { content: string; next: number } {
  if (src[start] === "{") return readGroup(src, start)
  if (src[start] === "\\") {
    const name = /^[a-zA-Z]+/.exec(src.slice(start + 1))?.[0]
    if (name) return { content: src.slice(start, start + 1 + name.length), next: start + 1 + name.length }
    return { content: src.slice(start, start + 2), next: start + 2 }
  }
  return { content: src[start] ?? "", next: Math.min(start + 1, src.length) }
}

function readOptional(src: string, start: number): { content: string; next: number } {
  if (src[start] !== "[") return { content: "", next: start }
  const end = src.indexOf("]", start)
  if (end === -1) return { content: "", next: start }
  return { content: src.slice(start + 1, end), next: end + 1 }
}

function wrapOperand(text: string): string {
  if (/^[\p{L}\p{N}.]+$/u.test(text) || text.length === 1) return text
  return `(${text})`
}

function mapScript(kind: "^" | "_", content: string): string {
  const mapped = mapChars(content, kind === "^" ? SUPERSCRIPT : SUBSCRIPT)
  if (mapped !== undefined) return mapped
  if (content.length === 1) return kind + content
  return `${kind}(${content})`
}

function mapChars(text: string, table: Record<string, string>): string | undefined {
  const chars = [...text].map((ch) => table[ch])
  if (chars.some((ch) => ch === undefined)) return undefined
  return chars.join("")
}

const TEXT_COMMANDS = new Set([
  "text",
  "textbf",
  "textit",
  "textrm",
  "texttt",
  "mathrm",
  "mathit",
  "mathbf",
  "mathsf",
  "mathcal",
  "mathfrak",
  "boldsymbol",
  "operatorname",
  "mbox",
])

const SKIP_COMMANDS = new Set(["limits", "nolimits", "displaystyle", "textstyle", "scriptstyle", "small", "notag"])

const ACCENTS: Record<string, string> = {
  hat: "\u0302",
  bar: "\u0304",
  tilde: "\u0303",
  vec: "\u20d7",
  dot: "\u0307",
  ddot: "\u0308",
  overline: "\u0304",
}

const SUPERSCRIPT: Record<string, string> = {
  "0": "⁰",
  "1": "¹",
  "2": "²",
  "3": "³",
  "4": "⁴",
  "5": "⁵",
  "6": "⁶",
  "7": "⁷",
  "8": "⁸",
  "9": "⁹",
  "+": "⁺",
  "-": "⁻",
  "−": "⁻",
  "=": "⁼",
  "(": "⁽",
  ")": "⁾",
  n: "ⁿ",
  i: "ⁱ",
  t: "ᵗ",
  k: "ᵏ",
  m: "ᵐ",
  s: "ˢ",
  x: "ˣ",
  T: "ᵀ",
  " ": " ",
}

const SUBSCRIPT: Record<string, string> = {
  "0": "₀",
  "1": "₁",
  "2": "₂",
  "3": "₃",
  "4": "₄",
  "5": "₅",
  "6": "₆",
  "7": "₇",
  "8": "₈",
  "9": "₉",
  "+": "₊",
  "-": "₋",
  "−": "₋",
  "=": "₌",
  "(": "₍",
  ")": "₎",
  a: "ₐ",
  e: "ₑ",
  h: "ₕ",
  i: "ᵢ",
  j: "ⱼ",
  k: "ₖ",
  l: "ₗ",
  m: "ₘ",
  n: "ₙ",
  o: "ₒ",
  p: "ₚ",
  r: "ᵣ",
  s: "ₛ",
  t: "ₜ",
  u: "ᵤ",
  v: "ᵥ",
  x: "ₓ",
  " ": " ",
}

const BLACKBOARD: Record<string, string> = {
  R: "ℝ",
  N: "ℕ",
  Z: "ℤ",
  Q: "ℚ",
  C: "ℂ",
  E: "𝔼",
  P: "ℙ",
  F: "𝔽",
  H: "ℍ",
}

const SYMBOLS: Record<string, string> = {
  alpha: "α",
  beta: "β",
  gamma: "γ",
  delta: "δ",
  epsilon: "ε",
  varepsilon: "ε",
  zeta: "ζ",
  eta: "η",
  theta: "θ",
  vartheta: "ϑ",
  iota: "ι",
  kappa: "κ",
  lambda: "λ",
  mu: "μ",
  nu: "ν",
  xi: "ξ",
  pi: "π",
  varpi: "ϖ",
  rho: "ρ",
  varrho: "ϱ",
  sigma: "σ",
  varsigma: "ς",
  tau: "τ",
  upsilon: "υ",
  phi: "φ",
  varphi: "φ",
  chi: "χ",
  psi: "ψ",
  omega: "ω",
  Gamma: "Γ",
  Delta: "Δ",
  Theta: "Θ",
  Lambda: "Λ",
  Xi: "Ξ",
  Pi: "Π",
  Sigma: "Σ",
  Upsilon: "Υ",
  Phi: "Φ",
  Psi: "Ψ",
  Omega: "Ω",
  times: "×",
  div: "÷",
  cdot: "⋅",
  pm: "±",
  mp: "∓",
  le: "≤",
  leq: "≤",
  ge: "≥",
  geq: "≥",
  ne: "≠",
  neq: "≠",
  approx: "≈",
  sim: "∼",
  simeq: "≃",
  cong: "≅",
  equiv: "≡",
  propto: "∝",
  ll: "≪",
  gg: "≫",
  infty: "∞",
  to: "→",
  rightarrow: "→",
  leftarrow: "←",
  gets: "←",
  Rightarrow: "⇒",
  Leftarrow: "⇐",
  Leftrightarrow: "⇔",
  leftrightarrow: "↔",
  mapsto: "↦",
  implies: "⇒",
  iff: "⇔",
  in: "∈",
  notin: "∉",
  ni: "∋",
  subset: "⊂",
  subseteq: "⊆",
  supset: "⊃",
  supseteq: "⊇",
  cup: "∪",
  cap: "∩",
  setminus: "∖",
  emptyset: "∅",
  varnothing: "∅",
  forall: "∀",
  exists: "∃",
  nexists: "∄",
  neg: "¬",
  lnot: "¬",
  land: "∧",
  wedge: "∧",
  lor: "∨",
  vee: "∨",
  oplus: "⊕",
  otimes: "⊗",
  odot: "⊙",
  perp: "⊥",
  parallel: "∥",
  angle: "∠",
  nabla: "∇",
  partial: "∂",
  sum: "∑",
  prod: "∏",
  int: "∫",
  iint: "∬",
  iiint: "∭",
  oint: "∮",
  cdots: "⋯",
  dots: "…",
  ldots: "…",
  vdots: "⋮",
  ddots: "⋱",
  prime: "′",
  circ: "∘",
  bullet: "•",
  star: "⋆",
  ast: "∗",
  aleph: "ℵ",
  hbar: "ℏ",
  ell: "ℓ",
  Re: "ℜ",
  Im: "ℑ",
  wp: "℘",
  mid: "|",
  vert: "|",
  Vert: "‖",
  langle: "⟨",
  rangle: "⟩",
  lfloor: "⌊",
  rfloor: "⌋",
  lceil: "⌈",
  rceil: "⌉",
  therefore: "∴",
  because: "∵",
  degree: "°",
  quad: "  ",
  qquad: "    ",
}
