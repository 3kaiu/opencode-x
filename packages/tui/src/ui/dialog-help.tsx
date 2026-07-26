import { TextAttributes, RGBA } from "@opentui/core"
import { createMemo, For } from "solid-js"
import { useTheme, selectedForeground, type Theme } from "../context/theme"
import { useDialog } from "./dialog"
import { useBindings, useCommandShortcut, useOpencodeKeymap, useKeymapSelector, formatKeyBindings, type OpenTuiKeymap } from "../keymap"
import { useTuiConfig } from "../config"

// Category accent colors rotate through theme palette for visual differentiation.
const CATEGORY_COLORS = ["primary", "secondary", "accent", "info", "success"] as const

function KeyBadge(props: { shortcut: string; theme: Theme }) {
  return (
    <box
      paddingLeft={1}
      paddingRight={1}
      backgroundColor={props.theme.backgroundElement}
      flexShrink={0}
    >
      <text fg={props.theme.text} attributes={TextAttributes.BOLD}>
        {props.shortcut}
      </text>
    </box>
  )
}

export function DialogHelp() {
  const dialog = useDialog()
  const { theme } = useTheme()
  const config = useTuiConfig()
  const keymap = useOpencodeKeymap()
  const commandShortcut = useCommandShortcut("command.palette.show")

  const entries = useKeymapSelector((keymap: OpenTuiKeymap) =>
    keymap.getCommandEntries({
      namespace: "palette",
      visibility: "reachable",
      filter: (cmd) => cmd.hidden !== true && cmd.name !== "command.palette.show",
    }),
  )

  const categories = createMemo(() => {
    const bindings = keymap.getCommandBindings({
      visibility: "registered",
      commands: entries().map((e) => e.command.name),
    })

    const commandsWithShortcuts = entries()
      .map((entry) => {
        const entryBindings = bindings.get(entry.command.name) ?? entry.bindings
        const shortcut = formatKeyBindings(entryBindings, config)
        return {
          title: typeof entry.command.title === "string" ? entry.command.title : entry.command.name,
          category: typeof entry.command.category === "string" ? entry.command.category : "Other",
          shortcut,
        }
      })
      .filter((cmd): cmd is { title: string; category: string; shortcut: string } => !!cmd.shortcut)

    const grouped = new Map<string, Array<{ title: string; shortcut: string }>>()
    for (const cmd of commandsWithShortcuts) {
      if (!grouped.has(cmd.category)) {
        grouped.set(cmd.category, [])
      }
      grouped.get(cmd.category)!.push({ title: cmd.title, shortcut: cmd.shortcut })
    }

    return Array.from(grouped.entries())
      .map(([name, commands]) => ({ name, commands }))
      .sort((a, b) => a.name.localeCompare(b.name))
  })

  useBindings(() => ({
    bindings: [
      { key: "return", desc: "Close help", group: "Dialog", cmd: () => dialog.clear() },
      { key: "escape", desc: "Close help", group: "Dialog", cmd: () => dialog.clear() },
    ],
  }))

  return (
    <box paddingLeft={2} paddingRight={2} gap={1}>
      <box flexDirection="row" justifyContent="space-between" alignItems="center">
        <box flexDirection="row" gap={1} alignItems="center">
          <text fg={theme.primary} attributes={TextAttributes.BOLD}>
            ⌨
          </text>
          <text attributes={TextAttributes.BOLD} fg={theme.text}>
            Keyboard Shortcuts
          </text>
        </box>
        <box
          paddingLeft={1}
          paddingRight={1}
          backgroundColor={theme.backgroundElement}
          onMouseUp={() => dialog.clear()}
        >
          <text fg={theme.textMuted}>esc/enter</text>
        </box>
      </box>
      <box paddingBottom={1}>
        <text fg={theme.textMuted}>
          Press {commandShortcut()} to see all available actions and commands in any context.
        </text>
      </box>
      <box gap={1}>
        <For each={categories()}>
          {(category, index) => {
            const accentColor = createMemo(() => {
              const key = CATEGORY_COLORS[index() % CATEGORY_COLORS.length]
              return theme[key] as RGBA
            })
            return (
              <box gap={0}>
                <box flexDirection="row" gap={1} alignItems="center">
                  <text fg={accentColor()} attributes={TextAttributes.BOLD}>
                    ▸
                  </text>
                  <text attributes={TextAttributes.BOLD} fg={theme.text}>
                    {category.name}
                  </text>
                </box>
                <For each={category.commands}>
                  {(cmd) => (
                    <box flexDirection="row" justifyContent="space-between" paddingLeft={2} alignItems="center">
                      <text fg={theme.textMuted}>{cmd.title}</text>
                      <KeyBadge shortcut={cmd.shortcut} theme={theme} />
                    </box>
                  )}
                </For>
              </box>
            )
          }}
        </For>
      </box>
      <box flexDirection="row" justifyContent="flex-end" paddingBottom={1}>
        <box
          paddingLeft={3}
          paddingRight={3}
          backgroundColor={theme.primary}
          onMouseUp={() => dialog.clear()}
        >
          <text fg={selectedForeground(theme)} attributes={TextAttributes.BOLD}>
            ok
          </text>
        </box>
      </box>
    </box>
  )
}
