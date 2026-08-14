import type {
  LlmToolContent,
  SessionMessageAssistantTool,
  ToolPresentationCall,
  ToolPresentationFileDiff,
  ToolPresentationResult,
} from "@opencode-ai/sdk/v2/types"
import { For, Match, Show, Switch } from "solid-js"

function DiffView(props: { diff: ToolPresentationFileDiff }) {
  return (
    <div class="card-diff">
      <span class="card-path">{props.diff.path}</span>
      {props.diff.oldText !== null && <pre class="diff-removed">{props.diff.oldText}</pre>}
      {props.diff.newText && <pre class="diff-added">{props.diff.newText}</pre>}
    </div>
  )
}

function ContentView(props: { content: Array<LlmToolContent> }) {
  return (
    <For each={props.content}>
      {(item) => (
        <div class={item.type === "text" ? "card-text" : "card-file"}>
          {item.type === "text" ? item.text : item.name ?? item.uri}
        </div>
      )}
    </For>
  )
}

export function ToolCard(props: { part: SessionMessageAssistantTool }) {
  const state = () => props.part.state
  const running = () => state().status === "running"
  const call = (): ToolPresentationCall | undefined => {
    const s = state()
    return s.status === "running" ? s.presentation : undefined
  }
  const result = (): ToolPresentationResult | undefined => {
    const s = state()
    if (s.status === "running" || s.status === "pending") return undefined
    return s.presentation
  }

  const terminalCall = () => {
    const p = call()
    return p?.card === "terminal" ? p : undefined
  }
  const terminalResult = () => {
    const p = result()
    return p?.card === "terminal" ? p : undefined
  }
  const diffCall = () => {
    const p = call()
    return p?.card === "diff" ? p : undefined
  }
  const diffResult = () => {
    const p = result()
    return p?.card === "diff" ? p : undefined
  }
  const genericCall = () => {
    const p = call()
    return p?.card === "generic" ? p : undefined
  }
  const genericResult = () => {
    const p = result()
    return p?.card === "generic" ? p : undefined
  }
  const read = () => {
    const p = result()
    return p?.card === "read" ? p : undefined
  }
  const searchMatches = () => {
    const p = result()
    return p?.card === "search" && p.shape === "matches" ? p : undefined
  }
  const searchPaths = () => {
    const p = result()
    return p?.card === "search" && p.shape === "paths" ? p : undefined
  }
  const webSearch = () => {
    const p = result()
    return p?.card === "web" && p.kind === "search" ? p : undefined
  }
  const webFetch = () => {
    const p = result()
    return p?.card === "web" && p.kind === "fetch" ? p : undefined
  }

  const title = () => {
    const p = running() ? call() : result()
    if (!p) return props.part.name
    if (p.card === "read") return p.title ?? `${props.part.name} ${p.path}`
    if (p.card === "web" && p.kind === "fetch") return p.title ?? p.url
    return p.title ?? props.part.name
  }

  const status = () => {
    const s = state()
    if (s.status === "running") return "running"
    if (s.status === "error") return "error"
    return "completed"
  }

  return (
    <div class={`card card-${status()}`}>
      <div class="card-head">
        <span class="card-status" />
        <span class="card-title">{title()}</span>
        {running() && <span class="card-spinner" />}
      </div>
      <Switch>
        <Match when={terminalCall()?.card === "terminal"}>
          {terminalCall()?.cwd && <div class="card-muted">in {terminalCall()?.cwd}</div>}
          {terminalCall()?.description && <div class="card-text">{terminalCall()?.description}</div>}
        </Match>
        <Match when={diffCall()?.card === "diff"}>
          <For each={diffCall()!.diffs}>{(item) => <DiffView diff={item} />}</For>
        </Match>
        <Match when={genericCall()?.card === "generic"}>
          <Show when={genericCall()?.locations}>
            <For each={genericCall()!.locations!}>
              {(loc) => <div class="card-path">{loc.path}{loc.line ? `:${loc.line}` : ""}</div>}
            </For>
          </Show>
          <Show when={genericCall()?.content}>
            <ContentView content={genericCall()!.content!} />
          </Show>
        </Match>
        <Match when={terminalResult()?.card === "terminal"}>
          {terminalResult()?.output !== undefined && <pre class="card-output">{terminalResult()?.output}</pre>}
          {(terminalResult()?.exitCode !== undefined || terminalResult()?.signal) && (
            <div class={terminalResult()?.exitCode === 0 ? "card-exit-ok" : "card-exit-fail"}>
              exit {terminalResult()?.signal ?? terminalResult()?.exitCode}
            </div>
          )}
        </Match>
        <Match when={diffResult()?.card === "diff"}>
          <For each={diffResult()!.diffs}>{(item) => <DiffView diff={item} />}</For>
        </Match>
        <Match when={searchMatches()?.shape === "matches"}>
          <For each={searchMatches()!.files}>
            {(file) => (
              <div class="card-diff">
                <span class="card-path">{file.path}</span>
                <For each={file.matches}>
                  {(match) => (
                    <pre class="search-line">
                      <span class="search-line-number">{match.lineNumber}</span> {match.line}
                    </pre>
                  )}
                </For>
              </div>
            )}
          </For>
        </Match>
        <Match when={searchPaths()?.shape === "paths"}>
          <For each={searchPaths()!.paths}>{(p) => <div class="card-path">{p}</div>}</For>
        </Match>
        <Match when={read()?.card === "read"}>
          <For each={read()!.lines}>
            {(line) => (
              <pre class="search-line">
                <span class="search-line-number">{line.number}</span> {line.text}
              </pre>
            )}
          </For>
          <Show when={read()?.content}>
            <ContentView content={read()!.content!} />
          </Show>
        </Match>
        <Match when={webSearch()?.kind === "search"}>
          {webSearch()?.answer && <div class="card-text">{webSearch()?.answer}</div>}
          <For each={webSearch()!.sources}>
            {(source) => (
              <a class="card-source" href={source.url} target="_blank" rel="noreferrer">
                {source.title ?? source.url}
              </a>
            )}
          </For>
        </Match>
        <Match when={webFetch()?.kind === "fetch"}>
          <a class="card-source" href={webFetch()!.url} target="_blank" rel="noreferrer">
            {webFetch()!.url}
          </a>
          {webFetch()?.statusCode !== undefined && (
            <span class={webFetch()?.statusCode === 200 ? "card-exit-ok" : "card-exit-fail"}>
              {" "}
              {webFetch()?.statusCode}
            </span>
          )}
        </Match>
        <Match when={genericResult()?.card === "generic"}>
          <Show when={genericResult()?.content}>
            <ContentView content={genericResult()!.content!} />
          </Show>
        </Match>
      </Switch>
    </div>
  )
}