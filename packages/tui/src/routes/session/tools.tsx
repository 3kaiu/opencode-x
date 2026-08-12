import { createMemo, createSignal, For, Match, onMount, Show, Switch } from "solid-js"
import type { BoxRenderable, RGBA } from "@opentui/core"
import { TextAttributes } from "@opentui/core"
import { useRenderer, type JSX } from "@opentui/solid"
import { useTheme } from "../../context/theme"
import { useTuiTerminalEnvironment } from "../../context/runtime"
import { useData } from "../../context/data"
import { useLocal } from "../../context/local"
import { useDialog } from "../../ui/dialog"
import { DialogAlert } from "../../ui/dialog-alert"
import { useRoute } from "../../context/route"
import { usePathFormatter } from "../../context/path-format"
import { TodoItem } from "../../component/todo-item"
import { CollapsedHint, Bullet, ResultBlock, toolStateColor, type ToolVisualState } from "../../component/message/primitives"
import { GLYPH } from "../../ui/glyphs"
import { Locale } from "../../util/locale"
import { space, PART_GAP } from "../../design-tokens"
import { filetype } from "../../util/filetype"
import { normalizePath } from "../../util/path"
import { collapseToolOutput } from "../../util/collapse-tool-output"
import { webSearchProviderLabel } from "../../util/tool-display"
import stripAnsi from "strip-ansi"
import { alwaysSeparate } from "./blocks"
import { use } from "./context"
import { useLocale } from "../../context/locale"
import {
  executeCalls,
  formatCompletedSubagentDetail,
  formatSubagentRetry,
  formatSubagentTitle,
  formatSubagentToolcalls,
  input,
  numberValue,
  parseApplyPatchFiles,
  parseDiagnostics,
  parseQuestionAnswers,
  parseQuestions,
  parseTodos,
  stringValue,
} from "./tool-utils"
import type { ToolPart } from "@opencode-ai/sdk/v2"

type ToolProps = {
  input: Record<string, unknown>
  metadata: Record<string, unknown>
  tool: string
  output?: string
  part: ToolPart
}

export function FilePathText(props: { path: string }) {
  const { theme } = useTheme()
  const dot = createMemo(() => {
    const idx = props.path.lastIndexOf(".")
    return idx > 0 && idx < props.path.length - 1 ? idx : -1
  })
  return (
    <>
      <span style={{ fg: theme.text }}>{dot() >= 0 ? props.path.slice(0, dot()) : props.path}</span>
      <Show when={dot() >= 0}>
        <span style={{ fg: theme.accent }}>{props.path.slice(dot())}</span>
      </Show>
    </>
  )
}

export function GenericTool(props: ToolProps) {
  const { theme } = useTheme()
  const locale = useLocale()
  const ctx = use()
  const output = createMemo(() => props.output?.trim() ?? "")
  const [expanded, setExpanded] = createSignal(false)
  const maxLines = 3
  const maxChars = createMemo(() => maxLines * Math.max(20, ctx.width - 6))
  const collapsed = createMemo(() => collapseToolOutput(output(), maxLines, maxChars()))
  const limited = createMemo(() => {
    if (expanded() || !collapsed().overflow) return output()
    return collapsed().output
  })

  return (
    <Show
      when={props.output && ctx.showGenericToolOutput()}
      fallback={
        <InlineTool pending={locale.t("tool.writingCommand")} complete={Boolean(props.output)} part={props.part}>
          {props.tool} {input(props.input)}
        </InlineTool>
      }
    >
      <BlockTool
        title={`${props.tool} ${input(props.input).trimEnd()}`}
        part={props.part}
        onClick={collapsed().overflow ? () => setExpanded((prev) => !prev) : undefined}
      >
        <box gap={1}>
          <text fg={theme.text}>{limited()}</text>
          <Show when={collapsed().overflow}>
            <CollapsedHint
              hidden={collapsed().hiddenCount ?? 0}
              expanded={expanded()}
              onToggle={() => setExpanded((prev) => !prev)}
            />
          </Show>
        </box>
      </BlockTool>
    </Show>
  )
}

export function InlineTool(props: {
  color?: RGBA
  complete: unknown
  pending: string
  failure?: string
  spinner?: boolean
  children: JSX.Element
  part: ToolPart
  onClick?: () => void
}) {
  const { theme } = useTheme()
  const ctx = use()
  const sync = useData()
  const renderer = useRenderer()
  const [hover, setHover] = createSignal(false)
  const [errorExpanded, setErrorExpanded] = createSignal(false)

  const permission = createMemo(() => {
    const callID = sync.instance.permission(ctx.sessionID)?.at(0)?.tool?.callID
    if (!callID) return false
    return callID === props.part.callID
  })

  const error = createMemo(() => (props.part.state.status === "error" ? props.part.state.error : undefined))

  const denied = createMemo(
    () =>
      error()?.includes("QuestionRejectedError") ||
      error()?.includes("rejected permission") ||
      error()?.includes("specified a rule") ||
      error()?.includes("user dismissed"),
  )

  const failed = createMemo(() => Boolean(error() && !denied()))
  const clickable = createMemo(() => Boolean(props.onClick || failed()))

  const visualState = createMemo<ToolVisualState>(() => {
    if (denied()) return "denied"
    if (failed()) return "error"
    if (permission()) return "permission"
    if (props.spinner) return "running"
    if (props.complete) return "complete"
    return "pending"
  })

  const colors = createMemo(() => {
    const base = toolStateColor(theme, visualState())
    if (props.color) return { dot: props.color, label: base.label }
    if (hover() && props.onClick) return { dot: base.dot, label: theme.text }
    return base
  })

  return (
    <InlineToolRow
      dotColor={colors().dot}
      labelColor={colors().label}
      errorColor={theme.error}
      failed={failed()}
      denied={Boolean(denied())}
      error={error()}
      errorExpanded={errorExpanded()}
      complete={props.complete}
      pending={props.pending}
      failure={props.failure}
      spinner={props.spinner}
      onMouseOver={() => clickable() && setHover(true)}
      onMouseOut={() => setHover(false)}
      onMouseUp={() => {
        if (renderer.getSelection()?.getSelectedText()) return
        if (failed()) {
          setErrorExpanded((value) => !value)
          return
        }
        props.onClick?.()
      }}
    >
      {props.children}
    </InlineToolRow>
  )
}

export function InlineToolRow(props: {
  dotColor?: RGBA
  labelColor?: RGBA
  errorColor?: RGBA
  failed?: boolean
  denied?: boolean
  error?: string
  errorExpanded?: boolean
  complete: unknown
  pending: string
  failure?: string
  spinner?: boolean
  children: JSX.Element
  onMouseOver?: () => void
  onMouseOut?: () => void
  onMouseUp?: () => void
}) {
  const { theme } = useTheme()
  const showContent = createMemo(() => Boolean(props.spinner || props.complete || props.failed))
  const body = () => {
    if (props.spinner) return props.children
    if (props.failed && !props.complete) return props.failure ?? props.children
    return props.children
  }
  return (
    <box
      paddingLeft={1}
      marginTop={PART_GAP}
      onMouseOver={props.onMouseOver}
      onMouseOut={props.onMouseOut}
      onMouseUp={props.onMouseUp}
    >
      <Bullet color={props.dotColor ?? theme.text} spinner={props.spinner}>
        <Show
          when={showContent()}
          fallback={<text fg={props.labelColor ?? theme.textMuted}>{props.pending}</text>}
        >
          <text
            fg={props.labelColor ?? theme.text}
            attributes={props.denied ? TextAttributes.STRIKETHROUGH : undefined}
          >
            {body()}
            <Show when={props.failed && props.error}>
              <span> {props.errorExpanded ? GLYPH.collapse : GLYPH.expand}</span>
            </Show>
          </text>
        </Show>
      </Bullet>
      <Show when={props.failed && props.errorExpanded}>
        <ResultBlock color={props.errorColor}>
          <text fg={props.errorColor}>
            {GLYPH.cross} {props.error}
          </text>
        </ResultBlock>
      </Show>
    </box>
  )
}

export function BlockTool(props: {
  title?: string
  children: JSX.Element
  onClick?: () => void
  part?: ToolPart
  spinner?: boolean
}) {
  const { theme } = useTheme()
  const renderer = useRenderer()
  const [hover, setHover] = createSignal(false)
  const error = createMemo(() => (props.part?.state.status === "error" ? props.part.state.error : undefined))
  const isRunning = createMemo(() => props.part?.state.status === "running")

  const dotColor = createMemo(() => {
    if (error()) return theme.error
    if (isRunning() || props.spinner) return theme.primary
    return theme.success
  })

  return (
    <box
      ref={(el: BoxRenderable) => alwaysSeparate.add(el)}
      marginTop={PART_GAP}
      paddingLeft={1}
      gap={space.xs}
      backgroundColor={hover() ? theme.backgroundElement : undefined}
      onMouseOver={() => props.onClick && setHover(true)}
      onMouseOut={() => setHover(false)}
      onMouseUp={() => {
        if (renderer.getSelection()?.getSelectedText()) return
        props.onClick?.()
      }}
    >
      <Show when={props.title}>
        <Bullet color={dotColor()} spinner={props.spinner}>
          <text fg={theme.text} attributes={TextAttributes.BOLD}>
            {props.title}
          </text>
        </Bullet>
      </Show>
      <ResultBlock color={dotColor()}>
        <box gap={space.xs}>{props.children}</box>
      </ResultBlock>
      <Show when={error()}>
        <ResultBlock color={theme.error}>
          <text fg={theme.error}>
            {GLYPH.cross} {error()}
          </text>
        </ResultBlock>
      </Show>
    </box>
  )
}

export function Shell(props: ToolProps) {
  const { theme } = useTheme()
  const locale = useLocale()
  const pathFormatter = usePathFormatter()
  const ctx = use()
  const isRunning = createMemo(() => props.part.state.status === "running")
  const output = createMemo(() => stripAnsi(stringValue(props.metadata.output)?.trim() ?? ""))
  const [expanded, setExpanded] = createSignal(false)
  const maxLines = 5
  const maxChars = createMemo(() => maxLines * Math.max(20, ctx.width - 6))
  const collapsed = createMemo(() => collapseToolOutput(output(), maxLines, maxChars()))
  const limited = createMemo(() => {
    if (expanded() || !collapsed().overflow) return output()
    return collapsed().output
  })

  const workdirDisplay = createMemo(() => {
    const workdir = stringValue(props.input.workdir)
    if (!workdir || workdir === ".") return undefined
    const formatted = pathFormatter.format(workdir)
    if (formatted === ".") return undefined
    return formatted
  })

  const title = createMemo(() => locale.t("tool.bash", { command: stringValue(props.input.command) ?? "" }))

  return (
    <Switch>
      <Match when={stringValue(props.metadata.output) !== undefined}>
        <BlockTool
          title={title()}
          part={props.part}
          spinner={isRunning()}
          onClick={collapsed().overflow ? () => setExpanded((prev) => !prev) : undefined}
        >
          <Show when={workdirDisplay()}>
            <text fg={theme.textMuted}>{locale.t("tool.in", { path: workdirDisplay() ?? "" })}</text>
          </Show>
          <Show when={output()}>
            <text fg={theme.text}>{limited()}</text>
          </Show>
          <Show when={collapsed().overflow}>
            <CollapsedHint
              hidden={collapsed().hiddenCount ?? 0}
              expanded={expanded()}
              onToggle={() => setExpanded((prev) => !prev)}
            />
          </Show>
        </BlockTool>
      </Match>
      <Match when={true}>
        <InlineTool
          pending={locale.t("tool.writingCommand")}
          complete={stringValue(props.input.command)}
          spinner={isRunning()}
          part={props.part}
        >
          {title()}
        </InlineTool>
      </Match>
    </Switch>
  )
}

export function Write(props: ToolProps) {
  const { theme, syntax } = useTheme()
  const locale = useLocale()
  const pathFormatter = usePathFormatter()
  const [expanded, setExpanded] = createSignal(false)
  const code = createMemo(() => {
    return stringValue(props.input.content) ?? ""
  })
  const lineCount = createMemo(() => (code() ? code().split("\n").length : 0))

  return (
    <Switch>
      <Match when={props.metadata.diagnostics !== undefined}>
        <BlockTool
          title={locale.t("tool.writeTitle", { path: pathFormatter.format(stringValue(props.input.filePath)) })}
          part={props.part}
          onClick={lineCount() > 0 ? () => setExpanded((prev) => !prev) : undefined}
        >
          <text fg={theme.text}>{locale.t("tool.wrote", { count: lineCount() })}</text>
          <Show when={expanded()}>
            <line_number fg={theme.textMuted} minWidth={3} paddingRight={1}>
              <code
                conceal={false}
                fg={theme.text}
                filetype={filetype(stringValue(props.input.filePath))}
                syntaxStyle={syntax()}
                content={code()}
              />
            </line_number>
          </Show>
          <Show when={lineCount() > 0}>
            <CollapsedHint
              hidden={expanded() ? 0 : lineCount()}
              expanded={expanded()}
              onToggle={() => setExpanded((prev) => !prev)}
            />
          </Show>
          <Diagnostics diagnostics={props.metadata.diagnostics} filePath={stringValue(props.input.filePath) ?? ""} />
        </BlockTool>
      </Match>
      <Match when={true}>
        <InlineTool pending={locale.t("tool.preparingWrite")} complete={stringValue(props.input.filePath)} part={props.part}>
          Write <FilePathText path={pathFormatter.format(stringValue(props.input.filePath))} />
        </InlineTool>
      </Match>
    </Switch>
  )
}

export function Glob(props: ToolProps) {
  const pathFormatter = usePathFormatter()
  const locale = useLocale()
  return (
    <InlineTool pending={locale.t("tool.findingFiles")} complete={stringValue(props.input.pattern)} part={props.part}>
      {locale.t("tool.glob", { pattern: stringValue(props.input.pattern) ?? "" })}{" "}
      <Show when={stringValue(props.input.path)}>
        {locale.t("tool.inPath", { path: pathFormatter.format(stringValue(props.input.path)) ?? "" })}{" "}
      </Show>
      <Show when={numberValue(props.metadata.count)}>
        {locale.t("tool.matchCount", { count: numberValue(props.metadata.count) ?? 0, s: numberValue(props.metadata.count) === 1 ? "" : "s" })}
      </Show>
    </InlineTool>
  )
}

export function Read(props: ToolProps) {
  const { theme } = useTheme()
  const locale = useLocale()
  const pathFormatter = usePathFormatter()
  const isRunning = createMemo(() => props.part.state.status === "running")
  const loaded = createMemo(() => {
    if (props.part.state.status !== "completed") return []
    if (props.part.state.time.compacted) return []
    const value = props.metadata.loaded
    if (!value || !Array.isArray(value)) return []
    return value.filter((p): p is string => typeof p === "string")
  })
  return (
    <>
      <InlineTool
        pending={locale.t("tool.readingFile")}
        complete={stringValue(props.input.filePath)}
        spinner={isRunning()}
        part={props.part}
      >
        Read <FilePathText path={pathFormatter.format(stringValue(props.input.filePath))} /> {input(props.input, ["filePath"])}
      </InlineTool>
      <For each={loaded()}>
        {(filepath) => (
          <box paddingLeft={1}>
            <ResultBlock>
              <text fg={theme.textMuted}>
                {locale.t("tool.loaded")} <FilePathText path={pathFormatter.format(filepath)} />
              </text>
            </ResultBlock>
          </box>
        )}
      </For>
    </>
  )
}

export function Grep(props: ToolProps) {
  const pathFormatter = usePathFormatter()
  const locale = useLocale()
  return (
    <InlineTool pending={locale.t("tool.searchingContent")} complete={stringValue(props.input.pattern)} part={props.part}>
      {locale.t("tool.grep", { pattern: stringValue(props.input.pattern) ?? "" })}{" "}
      <Show when={stringValue(props.input.path)}>
        {locale.t("tool.inPath", { path: pathFormatter.format(stringValue(props.input.path)) ?? "" })}{" "}
      </Show>
      <Show when={numberValue(props.metadata.matches)}>
        {locale.t("tool.matchCount", { count: numberValue(props.metadata.matches) ?? 0, s: numberValue(props.metadata.matches) === 1 ? "" : "s" })}
      </Show>
    </InlineTool>
  )
}

export function WebFetch(props: ToolProps) {
  const locale = useLocale()
  return (
    <InlineTool pending={locale.t("tool.fetchingWebPage")} complete={stringValue(props.input.url)} part={props.part}>
      WebFetch {stringValue(props.input.url)}
    </InlineTool>
  )
}

export function WebSearch(props: ToolProps) {
  const locale = useLocale()
  return (
    <InlineTool pending={locale.t("tool.searchingWeb")} complete={stringValue(props.input.query)} part={props.part}>
      {webSearchProviderLabel(props.metadata.provider)} "{stringValue(props.input.query)}"{" "}
      <Show when={numberValue(props.metadata.numResults)}>{locale.t("tool.results", { count: numberValue(props.metadata.numResults) ?? 0 })}</Show>
    </InlineTool>
  )
}

export function Task(props: ToolProps) {
  const { theme } = useTheme()
  const locale = useLocale()
  const { navigate } = useRoute()
  const sync = useData()
  const dialog = useDialog()
  const local = useLocal()
  const agentColor = createMemo(() => local.agent.color(stringValue(props.input.subagent_type) ?? "general"))

  onMount(() => {
    const sessionID = stringValue(props.metadata.sessionId)
    if (sessionID && !sync.instance.message(sessionID)?.length) void sync.session.v1.sync(sessionID)
  })

  const sessionID = createMemo(() => stringValue(props.metadata.sessionId))
  const messages = createMemo(() => sync.instance.message(sessionID() ?? "") ?? [])

  const tools = createMemo(() => {
    return messages().flatMap((msg) =>
      (sync.instance.part(msg.id) ?? [])
        .filter((part): part is ToolPart => part.type === "tool")
        .map((part) => ({ tool: part.tool, state: part.state })),
    )
  })

  const current = createMemo(() =>
    tools().findLast((x) => (x.state.status === "running" || x.state.status === "completed") && x.state.title),
  )

  const status = createMemo(() => sync.instance.session_status(sessionID() ?? ""))
  const isRunning = createMemo(() => {
    const value = status()
    return (
      props.part.state.status === "running" ||
      (props.metadata.background === true && value !== undefined && value.type !== "idle")
    )
  })
  const retry = createMemo(() => {
    const value = status()
    if (value?.type !== "retry") return
    return value
  })

  const duration = createMemo(() => {
    const first = messages().find((x) => x.role === "user")?.time.created
    const assistant = messages().findLast((x) => x.role === "assistant")?.time.completed
    if (!first || !assistant) return 0
    return assistant - first
  })

  const titleText = createMemo(() => {
    const titleText = stringValue(props.input.description)
    if (!titleText) return ""
    return formatSubagentTitle(
      Locale.titlecase(stringValue(props.input.subagent_type) ?? locale.t("tool.general")),
      titleText,
      props.metadata.background === true,
    )
  })

  const subline = createMemo<{ text: string; color?: RGBA } | undefined>(() => {
    const retrying = retry()
    if (isRunning() && retrying) {
      return {
        text: formatSubagentRetry(retrying.attempt, Locale.truncate(retrying.message, 80)),
        color: theme.error,
      }
    }
    if (isRunning() && tools().length > 0) {
      if (current()) {
        const state = current()!.state
        const title = state.status === "running" || state.status === "completed" ? state.title : undefined
        return { text: `${Locale.titlecase(current()!.tool)} ${title}` }
      }
      return { text: formatSubagentToolcalls(tools().length) }
    }
    if (!isRunning() && props.part.state.status === "completed") {
      return { text: `Done (${formatCompletedSubagentDetail(tools().length, Locale.duration(duration()))})` }
    }
    return undefined
  })

  return (
    <>
      <InlineTool
        color={retry() ? theme.error : isRunning() ? agentColor() : undefined}
        spinner={isRunning()}
        complete={stringValue(props.input.description)}
        pending={locale.t("tool.delegating")}
        part={props.part}
        onClick={() => {
          if (sessionID()) {
            navigate({ type: "session", sessionID: sessionID()! })
          }
          const status = retry()
          if (status) void DialogAlert.show(dialog, locale.t("tool.retryError"), status.message)
        }}
      >
        {titleText()}
      </InlineTool>
      <Show when={subline()}>
        <box paddingLeft={1}>
          <ResultBlock color={subline()!.color}>
            <text fg={subline()!.color ?? theme.textMuted}>{subline()!.text}</text>
          </ResultBlock>
        </box>
      </Show>
    </>
  )
}

export function Execute(props: ToolProps) {
  const ctx = use()
  const locale = useLocale()
  const { theme } = useTheme()
  const isLoading = createMemo(() => props.part.state.status === "pending" || props.part.state.status === "running")
  const calls = createMemo(() => executeCalls(props.metadata.toolCalls))
  const output = createMemo(() => stripAnsi(props.output?.trim() ?? ""))
  const hasRuntimeError = createMemo(() => props.metadata.error === true)
  const outputPreview = createMemo(() => collapseToolOutput(output(), 4, 4 * Math.max(20, ctx.width - 6)).output)
  const showOutput = createMemo(() => output() && hasRuntimeError())

  return (
    <>
      <InlineTool
        color={hasRuntimeError() ? theme.error : undefined}
        spinner={isLoading()}
        pending={locale.t("tool.executing")}
        complete={true}
        part={props.part}
      >
        execute
      </InlineTool>
      <For each={calls()}>
        {(call) => {
          const args = input(call.input ?? {})
          const failed = call.status === "error"
          return (
            <box paddingLeft={1}>
              <ResultBlock color={failed ? theme.error : undefined}>
                <text fg={failed ? theme.error : theme.textMuted}>
                  {call.tool}
                  {args ? ` ${args}` : ""}
                  {failed ? locale.t("tool.failed") : ""}
                </text>
              </ResultBlock>
            </box>
          )
        }}
      </For>
      <Show when={showOutput()}>
        <box paddingLeft={1}>
          <ResultBlock color={theme.error}>
            <text fg={theme.error}>{outputPreview()}</text>
          </ResultBlock>
        </box>
      </Show>
    </>
  )
}

export function Edit(props: ToolProps) {
  const ctx = use()
  const { theme, syntax } = useTheme()
  const locale = useLocale()
  const pathFormatter = usePathFormatter()

  const view = createMemo(() => {
    const diffStyle = ctx.tui.diff_style
    if (diffStyle === "stacked") return "unified"
    return ctx.width > 120 ? "split" : "unified"
  })

  const ft = createMemo(() => filetype(stringValue(props.input.filePath)))

  const diffContent = createMemo(() => stringValue(props.metadata.diff) ?? "")

  return (
    <Switch>
      <Match when={stringValue(props.metadata.diff) !== undefined}>
        <BlockTool title={locale.t("tool.updateTitle", { path: pathFormatter.format(stringValue(props.input.filePath)) })} part={props.part}>
          <box paddingLeft={1}>
            <diff
              diff={diffContent()}
              view={view()}
              filetype={ft()}
              syntaxStyle={syntax()}
              showLineNumbers={true}
              width="100%"
              wrapMode={ctx.diffWrapMode()}
              fg={theme.text}
              addedBg={theme.diffAddedBg}
              removedBg={theme.diffRemovedBg}
              contextBg={theme.diffContextBg}
              addedSignColor={theme.diffHighlightAdded}
              removedSignColor={theme.diffHighlightRemoved}
              lineNumberFg={theme.diffLineNumber}
              lineNumberBg={theme.diffContextBg}
              addedLineNumberBg={theme.diffAddedLineNumberBg}
              removedLineNumberBg={theme.diffRemovedLineNumberBg}
            />
          </box>
          <Diagnostics diagnostics={props.metadata.diagnostics} filePath={stringValue(props.input.filePath) ?? ""} />
        </BlockTool>
      </Match>
      <Match when={true}>
        <InlineTool pending={locale.t("tool.preparingEdit")} complete={stringValue(props.input.filePath)} part={props.part}>
          Update <FilePathText path={pathFormatter.format(stringValue(props.input.filePath))} />{" "}
          {input({ replaceAll: props.input.replaceAll })}
        </InlineTool>
      </Match>
    </Switch>
  )
}

export function ApplyPatch(props: ToolProps) {
  const ctx = use()
  const { theme, syntax } = useTheme()
  const locale = useLocale()
  const pathFormatter = usePathFormatter()

  const files = createMemo(() => parseApplyPatchFiles(props.metadata.files))

  const view = createMemo(() => {
    const diffStyle = ctx.tui.diff_style
    if (diffStyle === "stacked") return "unified"
    return ctx.width > 120 ? "split" : "unified"
  })

  function Diff(p: { diff: string; filePath: string }) {
    return (
      <box paddingLeft={1}>
        <diff
          diff={p.diff}
          view={view()}
          filetype={filetype(p.filePath)}
          syntaxStyle={syntax()}
          showLineNumbers={true}
          width="100%"
          wrapMode={ctx.diffWrapMode()}
          fg={theme.text}
          addedBg={theme.diffAddedBg}
          removedBg={theme.diffRemovedBg}
          contextBg={theme.diffContextBg}
          addedSignColor={theme.diffHighlightAdded}
          removedSignColor={theme.diffHighlightRemoved}
          lineNumberFg={theme.diffLineNumber}
          lineNumberBg={theme.diffContextBg}
          addedLineNumberBg={theme.diffAddedLineNumberBg}
          removedLineNumberBg={theme.diffRemovedLineNumberBg}
        />
      </box>
    )
  }

  function title(file: { type: string; relativePath: string; filePath: string; deletions: number }) {
    if (file.type === "delete") return locale.t("tool.deleted", { path: file.relativePath })
    if (file.type === "add") return locale.t("tool.created", { path: file.relativePath })
    if (file.type === "move") return locale.t("tool.moved", { from: pathFormatter.format(file.filePath), to: file.relativePath })
    return locale.t("tool.patched", { path: file.relativePath })
  }

  return (
    <Switch>
      <Match when={files().length > 0}>
        <For each={files()}>
          {(file) => (
            <BlockTool title={title(file)} part={props.part}>
              <Show
                when={file.type !== "delete"}
                fallback={
                  <text fg={theme.diffRemoved}>
                    -{file.deletions} line{file.deletions !== 1 ? "s" : ""}
                  </text>
                }
              >
                <Diff diff={file.patch} filePath={file.filePath} />
                <Diagnostics diagnostics={props.metadata.diagnostics} filePath={file.movePath ?? file.filePath} />
              </Show>
            </BlockTool>
          )}
        </For>
      </Match>
      <Match when={true}>
        <InlineTool pending={locale.t("tool.preparingPatch")} failure={locale.t("tool.patchFailed")} complete={true} part={props.part}>
          Patch
        </InlineTool>
      </Match>
    </Switch>
  )
}

export function TodoWrite(props: ToolProps) {
  const locale = useLocale()
  const todos = createMemo(() => parseTodos(props.input.todos))
  return (
    <Switch>
      <Match when={parseTodos(props.metadata.todos).length}>
        <BlockTool title={locale.t("tool.updateTodos")} part={props.part}>
          <For each={todos()}>{(todo) => <TodoItem status={todo.status} content={todo.content} />}</For>
        </BlockTool>
      </Match>
      <Match when={true}>
        <InlineTool pending={locale.t("tool.updatingTodos")} failure={locale.t("tool.todoUpdateFailed")} complete={true} part={props.part}>
          Updating todos...
        </InlineTool>
      </Match>
    </Switch>
  )
}

export function Question(props: ToolProps) {
  const { theme } = useTheme()
  const locale = useLocale()
  const questions = createMemo(() => parseQuestions(props.input.questions))
  const answers = createMemo(() => parseQuestionAnswers(props.metadata.answers))
  const count = createMemo(() => questions().length)

  function format(answer?: ReadonlyArray<string>) {
    if (!answer?.length) return locale.t("tool.noAnswer")
    return answer.join(", ")
  }

  return (
    <Switch>
      <Match when={answers()}>
        <BlockTool title={locale.t("tool.questions")} part={props.part}>
          <box gap={1}>
            <For each={questions()}>
              {(q, i) => (
                <box flexDirection="column">
                  <text fg={theme.textMuted}>{q.question}</text>
                  <text fg={theme.text}>{format(answers()?.[i()])}</text>
                </box>
              )}
            </For>
          </box>
        </BlockTool>
      </Match>
      <Match when={true}>
        <InlineTool pending={locale.t("tool.askingQuestions")} complete={count()} part={props.part}>
          {locale.t("tool.askedCount", { count: count(), s: count() !== 1 ? "s" : "" })}
        </InlineTool>
      </Match>
    </Switch>
  )
}

export function Skill(props: ToolProps) {
  const locale = useLocale()
  return (
    <InlineTool pending={locale.t("tool.loadingSkill")} complete={stringValue(props.input.name)} part={props.part}>
      Skill({stringValue(props.input.name)})
    </InlineTool>
  )
}

export function Diagnostics(props: { diagnostics: unknown; filePath: string }) {
  const { theme } = useTheme()
  const locale = useLocale()
  const terminalEnvironment = useTuiTerminalEnvironment()
  const MAX_VISIBLE = 3
  const errors = createMemo(() => {
    const normalized = normalizePath(
      typeof props.filePath === "string" ? props.filePath : "",
      terminalEnvironment.platform,
    )
    return parseDiagnostics(props.diagnostics, normalized)
  })
  const hidden = createMemo(() => Math.max(0, errors().length - MAX_VISIBLE))

  return (
    <Show when={errors().length}>
      <box>
        <For each={errors().slice(0, MAX_VISIBLE)}>
          {(diagnostic) => (
            <text fg={theme.error}>
              {GLYPH.cross} [{diagnostic.range.start.line + 1}:{diagnostic.range.start.character + 1}]{" "}
              {diagnostic.message}
            </text>
          )}
        </For>
        <Show when={hidden() > 0}>
          <text fg={theme.textMuted}>
            {GLYPH.ellipsis} {locale.t("tool.moreDiagnostics", { count: hidden(), s: hidden() === 1 ? "" : "s" })}
          </text>
        </Show>
      </box>
    </Show>
  )
}