export * as Presentation from "./presentation"

const CAP_CALL_TEXT = 2_000
const CAP_TERMINAL_OUTPUT = 32_000

/** Cap inline card text so presentation payloads stay bounded and replay-friendly. */
export const capText = (text: string, max: number) =>
  text.length <= max ? text : `${text.slice(0, max)}… [truncated]`

export const capCallText = (text: string) => capText(text, CAP_CALL_TEXT)
export const capTerminalOutput = (text: string) => capText(text, CAP_TERMINAL_OUTPUT)

const EXTENSION_LANG: Record<string, string> = {
  ts: "typescript",
  tsx: "tsx",
  js: "javascript",
  jsx: "jsx",
  json: "json",
  jsonc: "jsonc",
  md: "markdown",
  mdx: "markdown",
  sh: "shell",
  bash: "shell",
  css: "css",
  html: "html",
  py: "python",
  go: "go",
  rs: "rust",
  java: "java",
  rb: "ruby",
  yml: "yaml",
  yaml: "yaml",
  toml: "toml",
  sql: "sql",
  c: "c",
  h: "c",
  cpp: "cpp",
  hpp: "cpp",
  swift: "swift",
  kt: "kotlin",
}

export const langOf = (path: string): string | undefined => {
  const extension = path.split(".").at(-1)?.toLowerCase()
  return extension === undefined ? undefined : EXTENSION_LANG[extension]
}
