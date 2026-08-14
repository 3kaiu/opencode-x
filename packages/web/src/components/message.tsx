import type { SessionMessage, SessionMessageAssistant } from "@opencode-ai/sdk/v2/types"
import { For } from "solid-js"
import { ToolCard } from "./tool-card"

function UserMessage(props: { message: Extract<SessionMessage, { type: "user" }> }) {
  return (
    <div class="message user">
      <div class="message-bubble">{props.message.text}</div>
    </div>
  )
}

function AssistantMessage(props: { message: SessionMessageAssistant }) {
  return (
    <div class="message assistant">
      <div class="message-meta">
        {props.message.agent} · {props.message.model?.id}
      </div>
      <For each={props.message.content}>
        {(part) => (
          <div class={part.type === "text" ? "message-text" : undefined}>
            {part.type === "reasoning" ? (
              <details class="reasoning">
                <summary>reasoning</summary>
                <pre>{part.text}</pre>
              </details>
            ) : part.type === "tool" ? (
              <ToolCard part={part} />
            ) : (
              part.text
            )}
          </div>
        )}
      </For>
    </div>
  )
}

export function MessageView(props: { message: SessionMessage }) {
  if (props.message.type === "user") return <UserMessage message={props.message} />
  if (props.message.type === "assistant") return <AssistantMessage message={props.message} />
  return null
}