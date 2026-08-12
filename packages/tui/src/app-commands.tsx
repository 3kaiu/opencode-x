import { useRenderer } from "@opentui/solid"
import { createMemo } from "solid-js"
import { Flag } from "@opencode-ai/core/flag/flag"
import open from "open"
import { useDialog } from "./ui/dialog"
import { useToast } from "./ui/toast"
import { useRoute } from "./context/route"
import { useLocal } from "./context/local"
import { useKV } from "./context/kv"
import { useData } from "./context/data"
import { useProject } from "./context/project"
import { useExit } from "./context/exit"
import { useClipboard } from "./context/clipboard"
import { useTheme } from "./context/theme"
import { useLocale } from "./context/locale"
import { useConnected } from "./component/use-connected"
import { DialogModel } from "./component/dialog-model"
import { DialogMcp } from "./component/dialog-mcp"
import { DialogStatus } from "./component/dialog-status"
import { DialogDebug } from "./component/dialog-debug"
import { DialogThemeList } from "./component/dialog-theme-list"
import { DialogHelp } from "./ui/dialog-help"
import { DialogAgent } from "./component/dialog-agent"
import { DialogSessionList } from "./component/dialog-session-list"
import { DialogWorkspaceList } from "./component/dialog-workspace-list"
import { DialogProviderList } from "./component/dialog-provider"
import { DialogVariant } from "./component/dialog-variant"
import { CommandPaletteDialog } from "./component/command-palette"
import { COMMAND_PALETTE_COMMAND } from "./keymap"

export const appGlobalBindingCommands = [
  "session.list",
  "session.new",
  "session.quick_switch.1",
  "session.quick_switch.2",
  "session.quick_switch.3",
  "session.quick_switch.4",
  "session.quick_switch.5",
  "session.quick_switch.6",
  "session.quick_switch.7",
  "session.quick_switch.8",
  "session.quick_switch.9",
] as const

export const appBindingCommands = [
  "command.palette.show",
  "model.list",
  "model.cycle_recent",
  "model.cycle_recent_reverse",
  "model.cycle_favorite",
  "model.cycle_favorite_reverse",
  "agent.list",
  "mcp.list",
  "agent.cycle",
  "agent.cycle.reverse",
  "variant.cycle",
  "variant.list",
  "provider.connect",
  "console.org.switch",
  "opencode.status",
  "opencode.debug",
  "theme.switch",
  "theme.switch_mode",
  "theme.mode.lock",
  "help.show",
  "docs.open",
  "diff.open",
  "workspace.list",
  "app.debug",
  "app.console",
  "app.heap_snapshot",
  "terminal.suspend",
  "terminal.title.toggle",
  "app.toggle.animations",
  "app.toggle.file_context",
  "app.toggle.diffwrap",
  "app.toggle.paste_summary",
  "app.toggle.session_directory_filter",
] as const

export function isVersionGreater(left: string, right: string) {
  const parse = (value: string) => {
    const normalized = value.replace(/^v/, "")
    const dash = normalized.indexOf("-")
    const core = dash === -1 ? normalized : normalized.slice(0, dash)
    const prerelease = dash === -1 ? undefined : normalized.slice(dash + 1)
    return { core: core.split(".").map((part) => Number.parseInt(part, 10) || 0), prerelease }
  }
  const a = parse(left)
  const b = parse(right)
  for (let index = 0; index < Math.max(a.core.length, b.core.length); index++) {
    const difference = (a.core[index] ?? 0) - (b.core[index] ?? 0)
    if (difference) return difference > 0
  }
  if (a.prerelease === b.prerelease) return false
  if (!a.prerelease) return true
  if (!b.prerelease) return false
  return a.prerelease.localeCompare(b.prerelease, undefined, { numeric: true }) > 0
}

export function useAppCommands(input: { onSnapshot?: () => Promise<string[]> }) {
  const dialog = useDialog()
  const route = useRoute()
  const local = useLocal()
  const kv = useKV()
  const toast = useToast()
  const theme = useTheme()
  const locale = useLocale()
  const sync = useData()
  const project = useProject()
  const exit = useExit()
  const renderer = useRenderer()
  const clipboard = useClipboard()
  const connected = useConnected()
  const terminalTitleEnabled = () => kv.get("terminal_title_enabled", true)
  const pasteSummaryEnabled = () =>
    kv.get("paste_summary_enabled", !sync.instance.config.experimental?.disable_paste_summary)
  const currentWorktreeWorkspace = createMemo(() => {
    const workspaceID = project.workspace.current()
    if (!workspaceID) return
    const workspace = project.workspace.get(workspaceID)
    if (workspace?.type !== "worktree" || !workspace.directory) return
    return workspace
  })
  const commands = createMemo(() =>
    [
      {
        name: COMMAND_PALETTE_COMMAND,
        title: locale.t("command.showPalette"),
        category: locale.t("category.system"),
        hidden: true,
        run: () => {
          dialog.replace(() => <CommandPaletteDialog />)
        },
      },
      {
        name: "session.list",
        title: locale.t("command.switchSession"),
        category: locale.t("category.session"),
        suggested: sync.session.list().length > 0,
        slashName: "sessions",
        slashAliases: ["resume", "continue"],
        run: () => {
          dialog.replace(() => <DialogSessionList />)
        },
      },
      {
        name: "session.new",
        title: locale.t("command.newSession"),
        suggested: route.data.type === "session",
        category: locale.t("category.session"),
        slashName: "new",
        slashAliases: ["clear"],
        run: () => {
          route.navigate({
            type: "home",
          })
          dialog.clear()
        },
      },
      {
        name: "workspace.copy_path",
        title: locale.t("command.copyWorktreePath"),
        category: locale.t("category.workspace"),
        enabled: () => currentWorktreeWorkspace() !== undefined,
        run: async () => {
          const workspace = currentWorktreeWorkspace()
          if (!workspace?.directory) return
          await clipboard
            .write?.(workspace.directory)
            .then(() => toast.show({ message: locale.t("command.copiedWorktreePath"), variant: "info" }))
            .catch(toast.error)
          dialog.clear()
        },
      },
      {
        name: "workspace.list",
        title: locale.t("command.manageWorkspaces"),
        category: locale.t("category.workspace"),
        hidden: !Flag.OPENCODE_EXPERIMENTAL_WORKSPACES,
        slashName: "workspaces",
        run: () => {
          dialog.replace(() => <DialogWorkspaceList />)
        },
      },
      ...Array.from({ length: 9 }, (_, i) => ({
        name: `session.quick_switch.${i + 1}`,
        title: locale.t("command.quickSlot", { index: i + 1 }),
        category: locale.t("category.session"),
        hidden: true,
        run: () => {
          local.session.quickSwitch(i + 1)
        },
      })),
      {
        name: "model.list",
        title: locale.t("command.switchModel"),
        suggested: true,
        category: locale.t("category.agent"),
        slashName: "models",
        // Bias /mo toward /models over /move without changing global fuzzy scoring.
        slashAliases: ["mo"],
        run: () => {
          dialog.replace(() => <DialogModel />)
        },
      },
      {
        name: "model.cycle_recent",
        title: locale.t("command.modelCycle"),
        category: locale.t("category.agent"),
        hidden: true,
        run: () => {
          local.model.cycle(1)
        },
      },
      {
        name: "model.cycle_recent_reverse",
        title: locale.t("command.modelCycleReverse"),
        category: locale.t("category.agent"),
        hidden: true,
        run: () => {
          local.model.cycle(-1)
        },
      },
      {
        name: "model.cycle_favorite",
        title: locale.t("command.favoriteCycle"),
        category: locale.t("category.agent"),
        hidden: true,
        run: () => {
          local.model.cycleFavorite(1)
        },
      },
      {
        name: "model.cycle_favorite_reverse",
        title: locale.t("command.favoriteCycleReverse"),
        category: locale.t("category.agent"),
        hidden: true,
        run: () => {
          local.model.cycleFavorite(-1)
        },
      },
      {
        name: "agent.list",
        title: locale.t("command.switchAgent"),
        category: locale.t("category.agent"),
        slashName: "agents",
        run: () => {
          dialog.replace(() => <DialogAgent />)
        },
      },
      {
        name: "mcp.list",
        title: locale.t("command.toggleMcps"),
        category: locale.t("category.agent"),
        slashName: "mcps",
        run: () => {
          dialog.replace(() => <DialogMcp />)
        },
      },
      {
        name: "agent.cycle",
        title: locale.t("command.agentCycle"),
        category: locale.t("category.agent"),
        hidden: true,
        run: () => {
          local.agent.move(1)
        },
      },
      {
        name: "variant.cycle",
        title: locale.t("command.variantCycle"),
        category: locale.t("category.agent"),
        run: () => {
          local.model.variant.cycle()
        },
      },
      {
        name: "variant.list",
        title: locale.t("command.switchVariant"),
        category: locale.t("category.agent"),
        hidden: local.model.variant.list().length === 0,
        slashName: "variants",
        run: () => {
          if (local.model.variant.list().length === 0) {
            return toast.show({
              title: locale.t("command.noVariantsAvailable"),
              message: locale.t("command.noVariantsMessage"),
              variant: "info",
            })
          }
          dialog.replace(() => <DialogVariant />)
        },
      },
      {
        name: "agent.cycle.reverse",
        title: locale.t("command.agentCycleReverse"),
        category: locale.t("category.agent"),
        hidden: true,
        run: () => {
          local.agent.move(-1)
        },
      },
      {
        name: "provider.connect",
        title: locale.t("command.connectProvider"),
        suggested: !connected(),
        slashName: "connect",
        run: () => {
          dialog.replace(() => <DialogProviderList />)
        },
        category: locale.t("category.provider"),
      },
      {
        name: "opencode.status",
        title: locale.t("command.viewStatus"),
        slashName: "status",
        run: () => {
          dialog.replace(() => <DialogStatus />)
        },
        category: locale.t("category.system"),
      },
      {
        name: "opencode.debug",
        title: locale.t("command.viewDebugInfo"),
        slashName: "debug",
        run: () => {
          dialog.replace(() => <DialogDebug />)
        },
        category: locale.t("category.system"),
      },
      {
        name: "theme.switch",
        title: locale.t("command.switchTheme"),
        slashName: "themes",
        run: () => {
          dialog.replace(() => <DialogThemeList />)
        },
        category: locale.t("category.system"),
      },
      {
        name: "theme.switch_mode",
        title: theme.mode() === "dark" ? locale.t("command.switchToLightMode") : locale.t("command.switchToDarkMode"),
        run: () => {
          theme.setMode(theme.mode() === "dark" ? "light" : "dark")
          dialog.clear()
        },
        category: locale.t("category.system"),
      },
      {
        name: "theme.mode.lock",
        title: theme.locked() ? locale.t("command.unlockTheme") : locale.t("command.lockTheme"),
        run: () => {
          if (theme.locked()) theme.unlock()
          else theme.lock()
          dialog.clear()
        },
        category: locale.t("category.system"),
      },
      {
        name: "help.show",
        title: locale.t("command.help"),
        slashName: "help",
        run: () => {
          dialog.replace(() => <DialogHelp />)
        },
        category: locale.t("category.system"),
      },
      {
        name: "docs.open",
        title: locale.t("command.openDocs"),
        run: () => {
          open("https://opencode.ai/docs").catch(() => {})
          dialog.clear()
        },
        category: locale.t("category.system"),
      },
      {
        name: "app.exit",
        title: locale.t("command.exitApp"),
        slashName: "exit",
        slashAliases: ["quit", "q"],
        run: () => exit(),
        category: locale.t("category.system"),
      },
      {
        name: "app.debug",
        title: locale.t("command.toggleDebugPanel"),
        category: locale.t("category.system"),
        run: () => {
          renderer.toggleDebugOverlay()
          dialog.clear()
        },
      },
      {
        name: "app.console",
        title: locale.t("command.toggleConsole"),
        category: locale.t("category.system"),
        run: () => {
          renderer.console.toggle()
          dialog.clear()
        },
      },
      {
        name: "app.heap_snapshot",
        title: locale.t("command.heapSnapshot"),
        category: locale.t("category.system"),
        run: async () => {
          const files = await input.onSnapshot?.()
          toast.show({
            variant: "info",
            message: files?.length ? locale.t("command.heapSnapshotWritten", { files: files.join(", ") }) : locale.t("command.heapSnapshotUnavailable"),
            duration: 5000,
          })
          dialog.clear()
        },
      },
      {
        name: "terminal.suspend",
        title: locale.t("command.suspendTerminal"),
        category: locale.t("category.system"),
        hidden: true,
        enabled: process.platform !== "win32",
        run: () => {
          renderer.suspend()
          process.once("SIGCONT", () => renderer.resume())
          process.kill(0, "SIGTSTP")
        },
      },
      {
        name: "terminal.title.toggle",
        title: terminalTitleEnabled() ? locale.t("command.disableTerminalTitle") : locale.t("command.enableTerminalTitle"),
        category: locale.t("category.system"),
        run: () => {
          const next = !terminalTitleEnabled()
          kv.set("terminal_title_enabled", next)
          if (!next) renderer.setTerminalTitle("")
          dialog.clear()
        },
      },
      {
        name: "app.toggle.animations",
        title: kv.get("animations_enabled", true) ? locale.t("command.disableAnimations") : locale.t("command.enableAnimations"),
        category: locale.t("category.system"),
        run: () => {
          kv.set("animations_enabled", !kv.get("animations_enabled", true))
          dialog.clear()
        },
      },
      {
        name: "app.toggle.file_context",
        title: kv.get("file_context_enabled", true) ? locale.t("command.disableFileContext") : locale.t("command.enableFileContext"),
        category: locale.t("category.system"),
        run: () => {
          kv.set("file_context_enabled", !kv.get("file_context_enabled", true))
          dialog.clear()
        },
      },
      {
        name: "app.toggle.diffwrap",
        title: kv.get("diff_wrap_mode", "word") === "word" ? locale.t("command.disableDiffWrapping") : locale.t("command.enableDiffWrapping"),
        category: locale.t("category.system"),
        run: () => {
          const current = kv.get("diff_wrap_mode", "word")
          kv.set("diff_wrap_mode", current === "word" ? "none" : "word")
          dialog.clear()
        },
      },
      {
        name: "app.toggle.paste_summary",
        title: pasteSummaryEnabled() ? locale.t("command.disablePasteSummary") : locale.t("command.enablePasteSummary"),
        category: locale.t("category.system"),
        run: () => {
          kv.set("paste_summary_enabled", !pasteSummaryEnabled())
          dialog.clear()
        },
      },
      {
        name: "app.toggle.session_directory_filter",
        title: kv.get("session_directory_filter_enabled", true)
          ? locale.t("command.disableSessionDirectoryFiltering")
          : locale.t("command.enableSessionDirectoryFiltering"),
        category: locale.t("category.system"),
        run: async () => {
          kv.set("session_directory_filter_enabled", !kv.get("session_directory_filter_enabled", true))
          await sync.session.v1.refresh()
          dialog.clear()
        },
      },
      {
        name: "permission.mode",
        title:
          local.permission.mode === "auto" ? locale.t("command.disableAutoApprovePermissions") : locale.t("command.enableAutoApprovePermissions"),
        category: locale.t("category.system"),
        run: () => {
          local.permission.toggle()
          dialog.clear()
        },
      },
    ].map((command) => ({
      namespace: "palette",
      ...command,
    })),
  )
  return { commands, terminalTitleEnabled }
}
