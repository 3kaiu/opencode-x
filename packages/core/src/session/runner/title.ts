// V2 runner session title derivation (detached background provider turn).
export * as RunnerTitle from "./title"

export const TITLE_PROMPT = `You are a title generator for a coding agent conversation. Output ONLY the title and nothing else.
Requirements:
- Maximum 100 characters.
- Be specific to the user's first message.
- Do not include punctuation or quotes.
- Do not use phrases like "Coding session" or "General".
- If no title can be derived, output "New session".
The user's first message:
`
