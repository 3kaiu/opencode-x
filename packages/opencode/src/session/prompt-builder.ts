export interface EnvInput {
  modelId: string
  providerId: string
  directory: string
  worktree: string
  isGit: boolean
  platform: string
  date: string
}

export interface ReferenceInfo {
  name: string
  path: string
  description?: string
}

export interface SkillInfo {
  name: string
  description?: string
  location: string
}

export interface McpInstruction {
  name: string
  instructions: string
  tools: string[]
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;")
}

export function selectProviderTemplate(modelId: string): string {
  if (modelId.includes("gpt-4") || modelId.includes("o1") || modelId.includes("o3")) return "beast"
  if (modelId.includes("gpt")) {
    if (modelId.includes("codex")) return "codex"
    return "gpt"
  }
  if (modelId.includes("gemini-")) return "gemini"
  if (modelId.includes("claude")) return "anthropic"
  if (modelId.toLowerCase().includes("trinity")) return "trinity"
  if (modelId.toLowerCase().includes("kimi")) return "kimi"
  return "default"
}

export function assembleEnvironment(env: EnvInput, references: ReferenceInfo[]): string {
  let block = [
    `You are powered by the model named ${env.modelId}. The exact model ID is ${env.providerId}/${env.modelId}`,
    "Here is some useful information about the environment you are running in:",
    "<env>",
    `  Working directory: ${env.directory}`,
    `  Workspace root folder: ${env.worktree}`,
    `  Is directory a git repo: ${env.isGit ? "yes" : "no"}`,
    `  Platform: ${env.platform}`,
    `  Today's date: ${env.date}`,
    "</env>",
  ].join("\n")

  if (references.length > 0) {
    const sorted = [...references].sort((a, b) => a.name.localeCompare(b.name))
    const refBlock = [
      "\nProject references provide additional directories that can be accessed when relevant.",
      "<available_references>",
      ...sorted.map((r) => {
        let entry = `  <reference>\n    <name>${r.name}</name>\n    <path>${r.path}</path>`
        if (r.description) entry += `\n    <description>${r.description}</description>`
        entry += "\n  </reference>"
        return entry
      }),
      "</available_references>",
    ].join("\n")
    block += "\n" + refBlock
  }

  return block
}

export function assembleSkillsBlock(skills: SkillInfo[], verbose: boolean): string {
  const described = skills.filter((s) => s.description)
  if (described.length === 0) return "No skills are currently available."

  const sorted = [...described].sort((a, b) => a.name.localeCompare(b.name))

  if (verbose) {
    return [
      "<available_skills>",
      ...sorted.map(
        (s) => `  <skill>\n    <name>${s.name}</name>\n    <description>${s.description}</description>\n    <location>${s.location}</location>\n  </skill>`,
      ),
      "</available_skills>",
    ].join("\n")
  }

  return [
    "## Available Skills",
    ...sorted.map((s) => `- **${s.name}**: ${s.description}`),
  ].join("\n")
}

export function assembleMcpBlock(instructions: McpInstruction[]): string {
  if (instructions.length === 0) return ""

  return [
    "<mcp_instructions>",
    ...instructions.map((item) => {
      const lines = item.instructions.split("\n").map((l) => `    ${l}`).join("\n")
      return `  <server name="${escapeXml(item.name)}">\n${lines}\n  </server>`
    }),
    "</mcp_instructions>",
  ].join("\n")
}

export function assembleSystemPrompt(
  agentPrompt: string | null,
  providerTemplate: string,
  envBlock: string,
  instructionBlock: string[],
  skillsBlock: string,
  userSystem: string | null,
  jsonSchema: boolean,
): string[] {
  const parts: string[] = []
  const base = agentPrompt ?? providerTemplate

  const systemParts: string[] = [base, envBlock, ...instructionBlock]
  if (skillsBlock) systemParts.push(skillsBlock)
  parts.push(systemParts.join("\n"))

  if (userSystem) parts.push(userSystem)

  if (jsonSchema) {
    parts.push(
      "You are a function that outputs valid JSON. Never include any text before or after the JSON object. " +
      "Your output must always be a single JSON object that conforms to the provided schema. " +
      "Do not wrap the JSON in markdown code blocks or any other formatting.",
    )
  }

  return parts
}
