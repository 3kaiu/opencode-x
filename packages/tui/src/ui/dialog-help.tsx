import { TextAttributes } from "@opentui/core"
import { createMemo } from "solid-js"
import { useTheme } from "../context/theme"
import { useDialog } from "./dialog"
import { useBindings, useCommandShortcut, useOpencodeKeymap, useKeymapSelector, formatKeyBindings } from "../keymap"
import { useTuiConfig } from "../config"

type HelpCategory = {
  name: string
  commands: Array<{ title: string; shortcut: string }>
}

export function DialogHelp() {
  const dialog = useDialog()
  const { theme } = useTheme()
  const config = useTuiConfig()
  const keymap = useOpencodeKeymap()
  const commandShortcut = useCommandShortcut("command.palette.show")

  const entries = useKeymapSelector((keymap: any) =>
    keymap.getCommandEntries({
      namespace: "palette",
      visibility: "reachable",
      filter: (cmd: any) => cmd.hidden !== true && cmd.name !== "command.palette.show",
    }),
  )

  const categories = createMemo(() => {
    const bindings = keymap.getCommandBindings({
      visibility: "registered",
      commands: entries().map((e: any) => e.command.name),
    })

    const commandsWithShortcuts = entries()
      .map((entry: any) => {
        const entryBindings = bindings.get(entry.command.name) ?? entry.bindings
        const shortcut = formatKeyBindings(entryBindings, config)
        return {
          title: typeof entry.command.title === "string" ? entry.command.title : entry.command.name,
          category: typeof entry.command.category === "string" ? entry.command.category : "Other",
          shortcut,
        }
      })
      .filter((cmd: any) => cmd.shortcut)

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
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={theme.text}>
          Keyboard Shortcuts
        </text>
        <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
          esc/enter
        </text>
      </box>
      <box paddingBottom={1}>
        <text fg={theme.textMuted}>
          Press {commandShortcut()} to see all available actions and commands in any context.
        </text>
      </box>
      <box gap={1}>
        {categories().map((category) => (
          <box gap={0}>
            <text attributes={TextAttributes.BOLD} fg={theme.text}>
              {category.name}
            </text>
            {category.commands.map((cmd) => (
              <box flexDirection="row" justifyContent="space-between" paddingLeft={2}>
                <text fg={theme.textMuted}>{cmd.title}</text>
                <text fg={theme.text}>{cmd.shortcut}</text>
              </box>
            ))}
          </box>
        ))}
      </box>
      <box flexDirection="row" justifyContent="flex-end" paddingBottom={1}>
        <box paddingLeft={3} paddingRight={3} backgroundColor={theme.primary} onMouseUp={() => dialog.clear()}>
          <text fg={theme.selectedListItemText}>ok</text>
        </box>
      </box>
    </box>
  )
}
