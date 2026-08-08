import { afterEach, describe, expect, test } from "bun:test"
import { Server } from "../../src/server/server"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances, tmpdir } from "../fixture/fixture"
import { bucketPath } from "../../src/server/routes/instance/httpapi/middleware/request-metrics"

afterEach(async () => {
  await disposeAllInstances()
  await resetDatabase()
})

describe("request metrics", () => {
  describe("path bucketing", () => {
    test("collapses to the first path segment", () => {
      expect(bucketPath("/session/ses_123/messages")).toBe("/session")
      expect(bucketPath("/config")).toBe("/config")
      expect(bucketPath("/")).toBe("/")
      expect(bucketPath("")).toBe("/")
    })

    test("strips query strings before bucketing", () => {
      expect(bucketPath("/session/ses_123/messages?limit=10&cursor=abc")).toBe("/session")
    })
  })

  describe("integration", () => {
    test("serves requests normally with the metrics middleware installed", async () => {
      await using tmp = await tmpdir({ config: { formatter: false, lsp: false, username: "metrics-test" } })
      const response = await Server.Default().app.request("/config", {
        headers: { "x-opencode-directory": tmp.path },
      })
      expect(response.status).toBe(200)
    })

    test("serves unknown paths through the router without a metrics crash", async () => {
      await using tmp = await tmpdir({ config: { formatter: false, lsp: false } })
      const response = await Server.Default().app.request("/nope/not-a-route?x=1", {
        headers: { "x-opencode-directory": tmp.path },
      })
      expect([200, 400, 404]).toContain(response.status)
    })
  })
})
