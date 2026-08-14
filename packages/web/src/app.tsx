import { createMemo, createSignal, For, Show } from "solid-js"
import { useData } from "./context/client"
import { MessageView } from "./components/message"

function SessionList() {
  const data = useData()
  const sessions = data.sessions
  return (
    <aside class="sidebar">
      <div class="sidebar-head">
        <span class="brand">opencode</span>
        <button onClick={() => void data.createSession().then((id) => void data.openSession(id))}>+</button>
      </div>
      <For each={sessions}>
        {(session) => (
          <button
            class={`session-item${session.id === data.active ? " active" : ""}`}
            onClick={() => void data.openSession(session.id)}
          >
            {session.title || session.id}
          </button>
        )}
      </For>
    </aside>
  )
}

function Chat() {
  const data = useData()
  const messages = createMemo(() => (data.active ? data.messages(data.active) ?? [] : []))
  const [input, setInput] = createSignal("")
  const busy = createMemo(() =>
    messages().some(
      (message) =>
        message.type === "assistant" &&
        message.content.some((part) => part.type === "tool" && part.state.status === "running"),
    ),
  )

  const send = () => {
    const text = input().trim()
    if (!text || !data.active) return
    void data.prompt(data.active, text)
    setInput("")
  }

  return (
    <main class="chat">
      <div class="messages">
        <For each={messages()}>
          {(message) => <MessageView message={message} />}
        </For>
      </div>
      <Show when={data.active}>
        <div class="composer">
          <textarea
            placeholder="Message"
            value={input()}
            onInput={(event) => setInput(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault()
                send()
              }
            }}
          />
          <button onClick={() => send()} disabled={!input().trim()}>
            Send
          </button>
          <button
            onClick={() => data.active && void data.interrupt(data.active)}
            disabled={!busy()}
          >
            Interrupt
          </button>
        </div>
      </Show>
    </main>
  )
}

export function App() {
  return (
    <div class="layout">
      <SessionList />
      <Chat />
    </div>
  )
}