import { createMemo, createSignal, For, Match, Show, Switch } from "solid-js"
import type { BoxRenderable, RGBA } from "@opentui/core"
import { TextAttributes } from "@opentui/core"
import { useTheme, selectedForeground } from "../../context/theme"
import { useLocal } from "../../context/local"
import { useLocale } from "../../context/locale"
import { useData } from "../../context/data"
import { useCommandShortcut, useOpencodeKeymap } from "../../keymap"
import { Bullet, ResultBlock, CollapsedHint } from "../../component/message/primitives"
import { useDialog } from "../../ui/dialog"
import { DialogConfirm } from "../../ui/dialog-confirm"
import { GLYPH } from "../../ui/glyphs"
import { Locale } from "../../util/locale"
import { polishMarkdown, splitProseAndCode } from "../../util/markdown"
import { reasoningSummary } from "../../context/thinking"
import { filetype } from "../../util/filetype"
import { Model } from "../../util/model"
import { space, MESSAGE_INDENT, MESSAGE_GAP, PART_GAP } from "../../design-tokens"
import { errorMessage } from "../../util/error"
import { alwaysSeparate } from "./blocks"
import { use } from "./context"
import {
  BlockTool,
  Edit,
  Execute,
  FilePathText,
  GenericTool,
  Glob,
  Grep,
  InlineTool,
  PresentationCard,
  Question,
  ApplyPatch,
  Read,
  Shell,
  Skill,
  Task,
  TodoWrite,
  WebFetch,
  WebSearch,
  Write,
} from "./tools"
import { toolDisplay } from "./tool-utils"
import type { AssistantMessage, Part, ReasoningPart, TextPart, ToolPart, UserMessage } from "@opencode-ai/sdk/v2"

function codeFiletype(lang: string): string {
  if (!lang) return "none"
  const lower = lang.toLowerCase()
  const viaExt = filetype("x." + lower)
  if (viaExt && viaExt !== "none") return viaExt
  return lower
}

function CodeBlock(props: { lang: string; body: string }) {
  const { theme, syntax } = useTheme()
  const [expanded, setExpanded] = createSignal(false)
  const lines = createMemo(() => props.body.split("\n"))
  const COLLAPSE_THRESHOLD = 24

  const overflow = createMemo(() => lines().length > COLLAPSE_THRESHOLD)
  const shown = createMemo(() =>
    overflow() && !expanded() ? lines().slice(0, COLLAPSE_THRESHOLD).join("\n") : props.body,
  )
  return (
    <box
      marginTop={PART_GAP}
      border={["left"]}
      borderColor={theme.border}
      backgroundColor={theme.backgroundPanel}
      paddingLeft={1}
      paddingRight={1}
    >
      <Show when={props.lang}>
        <text fg={theme.textMuted}>{props.lang}</text>
      </Show>
      <line_number fg={theme.textMuted} minWidth={3} paddingRight={1}>
        <code
          conceal={false}
          fg={theme.text}
          filetype={codeFiletype(props.lang)}
          syntaxStyle={syntax()}
          content={shown()}
        />
      </line_number>
      <Show when={overflow()}>
        <CollapsedHint
          hidden={expanded() ? 0 : lines().length - COLLAPSE_THRESHOLD}
          expanded={expanded()}
          onToggle={() => setExpanded((prev) => !prev)}
        />
      </Show>
    </box>
  )
}

function TextPart(props: { last: boolean; part: TextPart; message: AssistantMessage }) {
  const ctx = use()
  const local = useLocal()
  const { theme, syntax } = useTheme()
  const color = createMemo(() => local.agent.color(props.message.agent))
  const tableOptions = createMemo(() => ({
    style: "grid" as const,
    borderStyle: "rounded" as const,
    borderColor: theme.border,
    outerBorder: true,
    wrapMode: "word" as const,
  }))
  const streaming = createMemo(
    () => props.part.time?.end === undefined && props.message.time.completed === undefined,
  )
  const segments = createMemo(() => (streaming() ? [] : splitProseAndCode(props.part.text.trim())))
  return (
    <Show when={props.part.text.trim()}>
      <box ref={(el: BoxRenderable) => alwaysSeparate.add(el)} paddingLeft={1} marginTop={PART_GAP} flexShrink={0}>
        <Bullet color={color()}>
          <Show
            when={!streaming()}
            fallback={
              <markdown
                syntaxStyle={syntax()}
                streaming={true}
                internalBlockMode="top-level"
                content={props.part.text.trim()}
                tableOptions={tableOptions()}
                conceal={ctx.conceal()}
                fg={theme.markdownText}
                bg={theme.background}
              />
            }
          >
            <box flexDirection="column">
              <For each={segments()}>
                {(seg) =>
                  seg.type === "code" ? (
                    <CodeBlock lang={seg.lang} body={seg.body} />
                  ) : (
                    <markdown
                      syntaxStyle={syntax()}
                      streaming={false}
                      internalBlockMode="top-level"
                      content={ctx.conceal() ? polishMarkdown(seg.text) : seg.text}
                      tableOptions={tableOptions()}
                      conceal={ctx.conceal()}
                      fg={theme.markdownText}
                      bg={theme.background}
                    />
                  )
                }
              </For>
            </box>
          </Show>
        </Bullet>
      </box>
    </Show>
  )
}

function ToolPart(props: { last: boolean; part: ToolPart; message: AssistantMessage }) {
  const ctx = use()
  const display = createMemo(() => toolDisplay(props.part.tool))

  const shouldHide = createMemo(() => {
    if (ctx.showDetails()) return false
    if (props.part.state.status !== "completed") return false
    return true
  })

  const toolprops = {
    get metadata() {
      return props.part.state.status === "pending" ? {} : (props.part.state.metadata ?? {})
    },
    get input() {
      return props.part.state.input ?? {}
    },
    get output() {
      return props.part.state.status === "completed" ? props.part.state.output : undefined
    },
    get tool() {
      return props.part.tool
    },
    get part() {
      return props.part
    },
  }

  const presented = createMemo(() => props.part.state.status !== "pending" && "presentation" in props.part.state)

  return (
    <Show when={!shouldHide()}>
      <Switch>
        <Match when={presented()}>
          <PresentationCard {...toolprops} />
        </Match>
        <Match when={display() === "bash"}>
          <Shell {...toolprops} />
        </Match>
        <Match when={display() === "glob"}>
          <Glob {...toolprops} />
        </Match>
        <Match when={display() === "read"}>
          <Read {...toolprops} />
        </Match>
        <Match when={display() === "grep"}>
          <Grep {...toolprops} />
        </Match>
        <Match when={display() === "webfetch"}>
          <WebFetch {...toolprops} />
        </Match>
        <Match when={display() === "websearch"}>
          <WebSearch {...toolprops} />
        </Match>
        <Match when={display() === "write"}>
          <Write {...toolprops} />
        </Match>
        <Match when={display() === "edit"}>
          <Edit {...toolprops} />
        </Match>
        <Match when={display() === "task"}>
          <Task {...toolprops} />
        </Match>
        <Match when={display() === "execute"}>
          <Execute {...toolprops} />
        </Match>
        <Match when={display() === "apply_patch"}>
          <ApplyPatch {...toolprops} />
        </Match>
        <Match when={display() === "todowrite"}>
          <TodoWrite {...toolprops} />
        </Match>
        <Match when={display() === "question"}>
          <Question {...toolprops} />
        </Match>
        <Match when={display() === "skill"}>
          <Skill {...toolprops} />
        </Match>
        <Match when={true}>
          <GenericTool {...toolprops} />
        </Match>
      </Switch>
    </Show>
  )
}

const GROUP_TOOL_DISPLAYS = new Set(["read", "glob", "grep", "bash"])

type RenderGroup =
  | { type: "raw"; part: Part; last: boolean }
  | { type: "tool-group"; parts: ToolPart[]; last: boolean }

export function groupParts(parts: Part[]): RenderGroup[] {
  const result: RenderGroup[] = []
  let i = 0
  while (i < parts.length) {
    const p = parts[i]
    if (p.type !== "tool" || !GROUP_TOOL_DISPLAYS.has(toolDisplay(p.tool))) {
      result.push({ type: "raw", part: p, last: i === parts.length - 1 })
      i++
      continue
    }
    const display = toolDisplay(p.tool)
    const group: ToolPart[] = [p]
    let j = i + 1
    while (j < parts.length) {
      const next = parts[j]
      if (next.type !== "tool" || toolDisplay(next.tool) !== display) break
      group.push(next)
      j++
    }
    if (group.length >= 2) {
      result.push({ type: "tool-group", parts: group, last: j >= parts.length })
      i = j
      continue
    }
    result.push({ type: "raw", part: p, last: i === parts.length - 1 })
    i++
  }
  return result
}

function ToolGroup(props: { parts: ToolPart[]; message: AssistantMessage; last: boolean }) {
  const { theme } = useTheme()
  const [expanded, setExpanded] = createSignal(false)
  const [hover, setHover] = createSignal(false)
  const first = createMemo(() => props.parts[0])
  const display = createMemo(() => toolDisplay(first().tool))
  const hasError = createMemo(() => props.parts.some((p) => p.state.status === "error"))
  const allCompleted = createMemo(() => props.parts.every((p) => p.state.status === "completed"))
  const groupColor = createMemo(() => {
    if (hasError()) return theme.error
    if (allCompleted()) return theme.success
    return theme.textMuted
  })
  const labelColor = createMemo(() => (hover() ? theme.text : theme.textMuted))

  return (
    <>
      <box
        paddingLeft={1}
        marginTop={PART_GAP}
        onMouseOver={() => setHover(true)}
        onMouseOut={() => setHover(false)}
        onMouseUp={() => setExpanded((prev) => !prev)}
        backgroundColor={hover() ? theme.backgroundElement : undefined}
      >
        <Bullet color={groupColor()}>
          <text>
            <span style={{ fg: labelColor() }}>{display()} </span>
            <span style={{ fg: groupColor() }}>({props.parts.length})</span>
            <span style={{ fg: labelColor() }}>{expanded() ? ` ${GLYPH.collapse}` : ` ${GLYPH.expand}`}</span>
          </text>
        </Bullet>
      </box>
      <Show when={expanded()}>
        <For each={props.parts}>
          {(part, index) => (
            <ToolPart last={index() === props.parts.length - 1 && props.last} part={part} message={props.message} />
          )}
        </For>
      </Show>
    </>
  )
}

function ReasoningPart(props: { last: boolean; part: ReasoningPart; message: AssistantMessage }) {
  const { theme, subtleSyntax } = useTheme()
  const locale = useLocale()
  const ctx = use()
  const [expanded, setExpanded] = createSignal(false)
  const [hover, setHover] = createSignal(false)
  const content = createMemo(() => props.part.text.replace("[REDACTED]", "").trim())
  const isDone = createMemo(() => props.part.time.end !== undefined)
  const inMinimal = createMemo(() => ctx.thinkingMode() === "hide")
  const duration = createMemo(() => {
    const end = props.part.time.end
    return end === undefined ? 0 : Math.max(0, end - props.part.time.start)
  })
  const summary = createMemo(() => reasoningSummary(content()))
  const showBody = createMemo(() => !inMinimal() || expanded())
  const toggle = () => {
    if (!inMinimal()) return
    setExpanded((prev) => !prev)
  }

  return (
    <Show when={content()}>
      <box
        marginTop={PART_GAP}
        paddingLeft={1}
        onMouseOver={() => inMinimal() && setHover(true)}
        onMouseOut={() => setHover(false)}
        onMouseUp={toggle}
        backgroundColor={hover() ? theme.backgroundElement : undefined}
      >
        <Bullet color={theme.warning} glyph={GLYPH.thinking} spinner={!isDone()}>
          <text>
            {isDone() ? locale.t("thinking.done") : locale.t("thinking.inProgress")}
            <Show when={summary().title}>
              <span style={{ fg: theme.warning }}> {summary().title}</span>
            </Show>
            <Show when={isDone() && duration()}>
              <span style={{ fg: theme.textMuted }}> · {Locale.duration(duration())}</span>
            </Show>
            <Show when={inMinimal()}>
              <span style={{ fg: hover() ? theme.text : theme.warning, italic: true }}>
                {" "}
                {expanded() ? "(click to collapse)" : "(click to expand)"}
              </span>
            </Show>
          </text>
        </Bullet>
        <Show when={showBody() && summary().body}>
          <box paddingLeft={2} marginTop={PART_GAP}>
            <markdown
              syntaxStyle={subtleSyntax()}
              internalBlockMode="top-level"
              content={ctx.conceal() ? polishMarkdown(summary().body) : summary().body}
              conceal={ctx.conceal()}
              streaming={!isDone()}
              fg={theme.textMuted}
              bg={theme.background}
            />
          </box>
        </Show>
      </box>
    </Show>
  )
}

export function UserMessage(props: {
  message: UserMessage
  parts: Part[]
  onMouseUp: () => void
  index: number
  pending?: string
}) {
  const ctx = use()
  const local = useLocal()
  const text = createMemo(() => {
    const texts = props.parts
      .map((x) => {
        if (x.type === "text" && !x.synthetic) {
          return x.text
        }
        return null
      })
      .filter(Boolean)
    return texts.join("\n\n")
  })
  const files = createMemo(() => props.parts.flatMap((x) => (x.type === "file" ? [x] : [])))
  const { theme } = useTheme()
  const [hover, setHover] = createSignal(false)
  const queued = createMemo(() => props.pending && props.message.id > props.pending)
  const color = createMemo(() => local.agent.color(props.message.agent))
  const queuedFg = createMemo(() => selectedForeground(theme, color()))

  const compaction = createMemo(() => props.parts.find((x) => x.type === "compaction"))

  return (
    <>
      <Show when={text() || files().length > 0}>
        <box
          marginTop={props.index === 0 ? 0 : MESSAGE_GAP}
          paddingLeft={1}
          paddingRight={1}
          gap={space.xs}
          onMouseOver={() => setHover(true)}
          onMouseOut={() => setHover(false)}
          onMouseUp={props.onMouseUp}
          backgroundColor={hover() ? theme.backgroundElement : undefined}
        >
          <Show when={text()}>
            <Bullet color={color()}>
              <text fg={theme.text}>{text()}</text>
            </Bullet>
          </Show>
          <Show when={files().length > 0}>
            <box paddingLeft={2} flexDirection="row" gap={1} flexWrap="wrap">
              <For each={files()}>
                {(file) => {
                  const directory = file.mime === "application/x-directory"
                  return (
                    <text>
                      <span style={{ bg: theme.secondary, fg: theme.background }}>
                        {directory ? " Directory " : " File "}
                      </span>
                      <span style={{ bg: theme.backgroundElement, fg: theme.text }}>
                        {" "}
                        {file.filename}
                        {directory ? "/" : ""}{" "}
                      </span>
                    </text>
                  )
                }}
              </For>
            </box>
          </Show>
          <Show
            when={queued()}
            fallback={
              <Show when={ctx.showTimestamps()}>
                <text fg={theme.textMuted} paddingLeft={2}>
                  {Locale.todayTimeOrDateTime(props.message.time.created)}
                </text>
              </Show>
            }
          >
            <text fg={theme.textMuted} paddingLeft={2}>
              <span style={{ bg: color(), fg: queuedFg(), bold: true }}> QUEUED </span>
              <span style={{ fg: theme.textMuted }}> waiting for session...</span>
            </text>
          </Show>
        </box>
      </Show>
      <Show when={compaction()}>
        <text paddingLeft={MESSAGE_INDENT} marginTop={PART_GAP} fg={theme.borderActive}>
          ── Compaction ──
        </text>
      </Show>
    </>
  )
}

export function AssistantMessage(props: { message: AssistantMessage; parts: Part[]; last: boolean }) {
  const ctx = use()
  const local = useLocal()
  const { theme } = useTheme()
  const sync = useData()
  const messages = createMemo(() => sync.instance.message(props.message.sessionID) ?? [])
  const model = createMemo(() => Model.name(ctx.providers(), props.message.providerID, props.message.modelID))
  const agentColor = createMemo(() => local.agent.color(props.message.agent))
  const agentName = createMemo(() => props.message.agent || "assistant")
  const hasMultipleAgents = createMemo(() => {
    const agents = new Set(messages().filter((m) => m.role === "assistant").map((m) => (m as AssistantMessage).agent))
    return agents.size > 1
  })

  const final = createMemo(() => {
    return props.message.finish && !["tool-calls", "unknown"].includes(props.message.finish)
  })

  const duration = createMemo(() => {
    if (!final()) return 0
    if (!props.message.time.completed) return 0
    const user = messages().find((x) => x.role === "user" && x.id === props.message.parentID)
    if (!user || !user.time) return 0
    return props.message.time.completed - user.time.created
  })

  const childShortcut = useCommandShortcut("session.child.first")
  const backgroundShortcut = useCommandShortcut("session.background")

  const groups = createMemo(() => groupParts(props.parts))

  return (
    <>
      <Show when={hasMultipleAgents() && groups().some((g) => g.type === "raw" && g.part.type === "text")}>
        <box paddingLeft={MESSAGE_INDENT} marginTop={PART_GAP} flexDirection="row" gap={1} alignItems="center">
          <text fg={agentColor()} attributes={TextAttributes.BOLD}>
            {GLYPH.bullet} {agentName()}
          </text>
          <Show when={model()}>
            <text fg={theme.borderSubtle}>·</text>
            <text fg={theme.textMuted}>{model()}</text>
          </Show>
        </box>
      </Show>
      <For each={groups()}>
        {(group) => {
          if (group.type === "tool-group")
            return <ToolGroup parts={group.parts} message={props.message} last={group.last} />
          const part = group.part
          if (part.type === "text") return <TextPart last={group.last} part={part} message={props.message} />
          if (part.type === "tool") return <ToolPart last={group.last} part={part} message={props.message} />
          if (part.type === "reasoning") return <ReasoningPart last={group.last} part={part} message={props.message} />
          return undefined
        }}
      </For>
      <Show when={final() && duration() > 0}>
        <text paddingLeft={MESSAGE_INDENT} marginTop={PART_GAP} fg={theme.textMuted}>
          took {Locale.duration(duration())}
          <Show when={model()}>
            <span style={{ fg: theme.borderSubtle }}> {GLYPH.dot} </span>
            <span style={{ fg: theme.textMuted }}>{Locale.truncate(model()!, 40)}</span>
          </Show>
        </text>
      </Show>
      <Show when={props.parts.some((x) => x.type === "tool" && x.tool === "task")}>
        <box marginTop={PART_GAP} paddingLeft={MESSAGE_INDENT}>
          <text fg={theme.text}>
            {childShortcut()}
            <span style={{ fg: theme.textMuted }}> view subagents</span>
            <Show
              when={
                props.parts.some(
                  (x) =>
                    x.type === "tool" &&
                    x.tool === "task" &&
                    x.state.status === "running" &&
                    x.state.metadata?.background !== true,
                )
              }
            >
              <span style={{ fg: theme.borderSubtle }}> · </span>
              {backgroundShortcut()}
              <span style={{ fg: theme.textMuted }}> background</span>
            </Show>
          </text>
        </box>
      </Show>
      <Show when={props.message.error && props.message.error.name !== "MessageAbortedError"}>
        <box ref={(el: BoxRenderable) => alwaysSeparate.add(el)} marginTop={PART_GAP} paddingLeft={1} gap={space.xs}>
          <Bullet color={theme.error}>
            <text fg={theme.error} attributes={TextAttributes.BOLD}>
              Error
            </text>
          </Bullet>
          <ResultBlock color={theme.error}>
            <text fg={theme.error}>
              {GLYPH.cross} {errorMessage(props.message.error)}
            </text>
          </ResultBlock>
        </box>
      </Show>
    </>
  )
}

export function RevertBanner(props: {
  revert: () =>
    | {
        messageID: string
        reverted: ReadonlyArray<unknown>
        diffFiles?: ReadonlyArray<{ filename: string; additions: number; deletions: number }>
      }
    | undefined
}) {
  const redoShortcut = useCommandShortcut("session.redo")
  const [hover, setHover] = createSignal(false)
  const dialog = useDialog()
  const { theme } = useTheme()
  const locale = useLocale()
  const keymap = useOpencodeKeymap()

  const handleUnrevert = async () => {
    const confirmed = await DialogConfirm.show(
      dialog,
      locale.t("confirm.redo"),
      locale.t("confirm.redoMessage"),
      undefined,
      "cancel",
    )
    if (confirmed) {
      keymap.dispatchCommand("session.redo")
    }
  }
  return (
    <box
      onMouseOver={() => setHover(true)}
      onMouseOut={() => setHover(false)}
      onMouseUp={handleUnrevert}
      marginTop={PART_GAP}
      flexShrink={0}
      border={["left"]}
      borderColor={theme.warning}
    >
      <box
        paddingTop={1}
        paddingBottom={1}
        paddingLeft={2}
        backgroundColor={hover() ? theme.backgroundElement : undefined}
      >
        <text fg={theme.textMuted}>
          {props.revert()!.reverted.length} message{props.revert()!.reverted.length === 1 ? "" : "s"} reverted
        </text>
        <text fg={theme.textMuted}>
          <span style={{ fg: theme.text }}>{redoShortcut()}</span> or /redo to restore
        </text>
        <Show when={props.revert()!.diffFiles?.length}>
          <box marginTop={PART_GAP}>
            <For each={props.revert()!.diffFiles}>
              {(file) => (
                <text fg={theme.text}>
                  {file.filename}
                  <Show when={file.additions > 0}>
                    <span style={{ fg: theme.diffAdded }}> +{file.additions}</span>
                  </Show>
                  <Show when={file.deletions > 0}>
                    <span style={{ fg: theme.diffRemoved }}> -{file.deletions}</span>
                  </Show>
                </text>
              )}
            </For>
          </box>
        </Show>
      </box>
    </box>
  )
}
