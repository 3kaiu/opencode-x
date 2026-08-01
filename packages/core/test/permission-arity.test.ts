import { describe, expect, test } from "bun:test"
import { BashArity } from "@opencode-ai/core/permission/arity"

const tokenize = (command: string) => command.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? []

describe("BashArity.prefix", () => {
  test("keeps the whole single-word command", () => {
    expect(BashArity.prefix(tokenize("pwd"))).toEqual(["pwd"])
    expect(BashArity.prefix(tokenize("ls -la"))).toEqual(["ls"])
  })

  test("keeps explicit multi-token commands", () => {
    expect(BashArity.prefix(tokenize("git commit -m wip"))).toEqual(["git", "commit"])
    expect(BashArity.prefix(tokenize("npm run dev"))).toEqual(["npm", "run", "dev"])
    expect(BashArity.prefix(tokenize("docker compose up"))).toEqual(["docker", "compose", "up"])
  })

  test("keeps flag-free quoted arguments intact", () => {
    expect(BashArity.prefix(tokenize('git commit -m "a b c"'))).toEqual(["git", "commit"])
    expect(BashArity.prefix(tokenize("echo 'hello world'"))).toEqual(["echo"])
  })

  test("defaults to the first token for unknown commands", () => {
    expect(BashArity.prefix(tokenize("some-custom-tool --flag value"))).toEqual(["some-custom-tool"])
  })

  test("returns empty for no tokens", () => {
    expect(BashArity.prefix([])).toEqual([])
  })

  test("applies the longest matching prefix", () => {
    expect(BashArity.prefix(tokenize("npm run build extra args"))).toEqual(["npm", "run", "build"])
  })
})
