import { describe, expect, it } from "bun:test"
import { translate } from "../../src/util/i18n"

describe("translate", () => {
  it("returns the english template for en", () => {
    expect(translate("en", "plan.banner")).toContain("Plan mode")
  })

  it("returns the chinese template for zh", () => {
    expect(translate("zh", "plan.banner")).toContain("计划模式")
    expect(translate("zh", "thinking.inProgress")).toBe("思考中")
  })

  it("interpolates named parameters", () => {
    const hint = translate("en", "session.notFoundHint", { listShortcut: "<leader>l", newShortcut: "<leader>n" })
    expect(hint).toContain("<leader>l")
    expect(hint).toContain("<leader>n")
    expect(translate("zh", "session.notFoundHint", { listShortcut: "<leader>l", newShortcut: "<leader>n" })).toContain(
      "<leader>l",
    )
  })

  it("leaves unknown placeholders untouched", () => {
    expect(translate("en", "session.notFoundHint", {})).toContain("{listShortcut}")
  })
})