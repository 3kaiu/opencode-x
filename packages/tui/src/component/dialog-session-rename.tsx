import { DialogPrompt } from "../ui/dialog-prompt"
import { useDialog } from "../ui/dialog"
import { useData } from "../context/data"
import { createMemo } from "solid-js"
import { useSDK } from "../context/sdk"
import { useToast } from "../ui/toast"
import { errorMessage } from "../util/error"
import { useLocale } from "../context/locale"

interface DialogSessionRenameProps {
  session: string
}

export function DialogSessionRename(props: DialogSessionRenameProps) {
  const dialog = useDialog()
  const sync = useData()
  const sdk = useSDK()
  const toast = useToast()
  const locale = useLocale()
  const session = createMemo(() => sync.session.v1.get(props.session))

  return (
    <DialogPrompt
      title={locale.t("rename.title")}
      value={session()?.title}
      onConfirm={(value) => {
        sdk.client.v2.session
          .update({
            sessionID: props.session,
            title: value,
          })
          .then(() => toast.quick(locale.t("toast.renameSessionSuccess")))
          .catch((error) => {
            toast.show({ title: locale.t("toast.renameSessionFailed"), message: errorMessage(error), variant: "error" })
          })
        dialog.clear()
      }}
    />
  )
}
