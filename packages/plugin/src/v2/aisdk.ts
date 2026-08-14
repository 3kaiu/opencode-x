import type { LanguageModelV3 } from "@ai-sdk/provider"
import type { ModelInfo } from "@opencode-ai/sdk/v2/types"

export type AISDKHooksSpec = {
  sdk: {
    readonly model: ModelInfo
    readonly package: string
    readonly options: Record<string, any>
    sdk?: any
  }
  language: {
    readonly model: ModelInfo
    readonly sdk: any
    readonly options: Record<string, any>
    language?: LanguageModelV3
  }
}
