import { describe, expect, test } from "bun:test"
import { APICallError } from "ai"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ProviderError } from "@/provider/error"

const deepseekReasoningContent = (statusCode: number) =>
  new APICallError({
    message: `${statusCode} Bad Request`,
    url: "https://api.deepseek.com/v1/chat/completions",
    statusCode,
    responseBody: JSON.stringify({
      error: {
        message:
          "This model version does not support reasoning_content, please resend all assistant messages that contain reasoning_content",
      },
    }),
  })

const parsedApiError = (parsed: ProviderError.ParsedAPICallError) => {
  if (parsed.type !== "api_error") throw new Error("expected api_error")
  return parsed
}

describe("ProviderError.parseAPICallError", () => {
  test("adds a DeepSeek reasoning_content recovery hint on 400", () => {
    const parsed = parsedApiError(
      ProviderError.parseAPICallError({
        providerID: ProviderV2.ID.make("deepseek"),
        error: deepseekReasoningContent(400),
      }),
    )

    expect(parsed.message).toContain("DeepSeek requires previous reasoning to be resent verbatim")
  })

  test("does not hint when the DeepSeek error does not mention reasoning_content", () => {
    const error = new APICallError({
      message: "400 Bad Request",
      url: "https://api.deepseek.com/v1/chat/completions",
      statusCode: 400,
      responseBody: JSON.stringify({ error: { message: "Invalid model" } }),
    })
    const parsed = parsedApiError(
      ProviderError.parseAPICallError({
        providerID: ProviderV2.ID.make("deepseek"),
        error,
      }),
    )

    expect(parsed.message).not.toContain("resent verbatim")
  })

  test("does not hint for non-DeepSeek providers", () => {
    const parsed = parsedApiError(
      ProviderError.parseAPICallError({
        providerID: ProviderV2.ID.make("openai"),
        error: deepseekReasoningContent(400),
      }),
    )

    expect(parsed.message).not.toContain("resent verbatim")
  })

  test("does not crash when the error body message is not a string", () => {
    const error = new APICallError({
      message: "400 Bad Request",
      url: "https://api.deepseek.com/v1/chat/completions",
      statusCode: 400,
      responseBody: JSON.stringify({ error: { message: { code: "x" } } }),
    })
    const parsed = parsedApiError(
      ProviderError.parseAPICallError({
        providerID: ProviderV2.ID.make("deepseek"),
        error,
      }),
    )

    expect(parsed.message).toBe("400 Bad Request")
  })
})
