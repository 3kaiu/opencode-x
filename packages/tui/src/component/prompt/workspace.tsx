import { createSignal } from "solid-js"
import { useDialog } from "../../ui/dialog"
import { useSDK } from "../../context/sdk"
import { useProject } from "../../context/project"
import { useData } from "../../context/data"
import { useToast } from "../../ui/toast"
import { useLocale } from "../../context/locale"
import { errorMessage } from "../../util/error"
import {
  confirmWorkspaceFileChanges,
  openWorkspaceSelect,
  warpWorkspaceSession,
  type WorkspaceSelection,
} from "../dialog-workspace-create"

export function usePromptWorkspace(sessionID?: string) {
  const dialog = useDialog()
  const sdk = useSDK()
  const project = useProject()
  const sync = useData()
  const toast = useToast()
  const locale = useLocale()
  const [selection, setSelection] = createSignal<WorkspaceSelection>()
  const [creating, setCreating] = createSignal(false)

  async function create(selection: Extract<WorkspaceSelection, { type: "new" }>) {
    setCreating(true)
    let result
    try {
      result = await sdk.client.experimental.workspace.create({ type: selection.workspaceType, branch: null })
    } catch (err) {
      setSelection(undefined)
      setCreating(false)
      toast.show({ title: locale.t("workspace.createFailed"), message: errorMessage(err), variant: "error" })
      return
    }
    if (result.error || !result.data) {
      setSelection(undefined)
      setCreating(false)
      toast.show({
        title: locale.t("workspace.createFailed"),
        message: errorMessage(result.error ?? "no response"),
        variant: "error",
      })
      return
    }

    await project.workspace.sync()
    const workspace = result.data
    setSelection({
      type: "existing",
      workspaceID: workspace.id,
      workspaceType: workspace.type,
      workspaceName: workspace.name,
    })
    setCreating(false)
    return workspace
  }

  async function warp(selection: WorkspaceSelection) {
    if (!sessionID) {
      setSelection(selection)
      dialog.clear()
      if (selection.type === "new") void create(selection)
      return
    }
    const sourceWorkspaceID = project.workspace.current()
    const copyChanges = await confirmWorkspaceFileChanges({ dialog, sdk, sourceWorkspaceID })
    if (copyChanges === undefined) return
    setSelection(selection)
    dialog.clear()

    const workspace =
      selection.type === "none"
        ? { id: null, name: locale.t("workspace.localProject") }
        : selection.type === "existing"
          ? { id: selection.workspaceID, name: selection.workspaceName }
          : await create(selection)
    if (!workspace) return

    const warped = await warpWorkspaceSession({
      dialog,
      sdk,
      sync,
      project,
      toast,
      locale,
      sourceWorkspaceID,
      workspaceID: workspace.id,
      sessionID,
      copyChanges,
    })
    if (warped) toast.show({ message: locale.t("workspace.warpedTo", { name: workspace.name }), variant: "success" })
  }

  function open() {
    void openWorkspaceSelect({ dialog, sdk, sync, project, toast, locale, onSelect: warp })
  }

  return { selection, creating, open, warp }
}
