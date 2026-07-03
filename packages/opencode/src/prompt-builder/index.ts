import type * as NativeTypes from "./native"

const Native = require("./index.node") as {
  selectProviderTemplate: (modelId: string) => string
  assembleEnvironment: (env: NativeTypes.EnvInput, references: NativeTypes.ReferenceInfo[]) => string
  assembleSkillsBlock: (skills: NativeTypes.SkillInfo[], verbose: boolean) => string
  assembleMcpBlock: (instructions: NativeTypes.McpInstruction[]) => string
  assembleSystemPrompt: (
    agentPrompt: string | null,
    providerTemplate: string,
    envBlock: string,
    instructionBlock: string[],
    skillsBlock: string,
    userSystem: string | null,
    jsonSchema: boolean,
  ) => string[]
}

export const selectProviderTemplate = Native.selectProviderTemplate
export const assembleEnvironment = Native.assembleEnvironment
export const assembleSkillsBlock = Native.assembleSkillsBlock
export const assembleMcpBlock = Native.assembleMcpBlock
export const assembleSystemPrompt = Native.assembleSystemPrompt

export type EnvInput = NativeTypes.EnvInput
export type ReferenceInfo = NativeTypes.ReferenceInfo
export type SkillInfo = NativeTypes.SkillInfo
export type McpInstruction = NativeTypes.McpInstruction
