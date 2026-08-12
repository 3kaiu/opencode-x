import { createMemo } from "solid-js"
import { useLocal } from "../context/local"
import { useLocale } from "../context/locale"
import { DialogSelect } from "../ui/dialog-select"
import { useDialog } from "../ui/dialog"

export function DialogVariant() {
  const local = useLocal()
  const locale = useLocale()
  const dialog = useDialog()

  const options = createMemo(() => {
    return [
      {
        value: "default",
        title: locale.t("variant.default"),
        onSelect: () => {
          dialog.clear()
          local.model.variant.set(undefined)
        },
      },
      ...local.model.variant.list().map((variant) => ({
        value: variant,
        title: variant,
        onSelect: () => {
          dialog.clear()
          local.model.variant.set(variant)
        },
      })),
    ]
  })

  return (
    <DialogSelect<string>
      options={options()}
      title={locale.t("variant.select")}
      current={local.model.variant.selected()}
      flat={true}
    />
  )
}
