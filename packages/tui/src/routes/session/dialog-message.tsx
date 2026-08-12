import { createMemo } from "solid-js"
import { useData } from "../../context/data"
import { DialogSelect } from "../../ui/dialog-select"
import { useSDK } from "../../context/sdk"
import { useRoute } from "../../context/route"
import { useClipboard } from "../../context/clipboard"
import { useToast } from "../../ui/toast"
import type { PromptInfo } from "../../component/prompt/history"
import { stripPromptPartIDs } from "../../prompt/part"
import { useLocale } from "../../context/locale"

export function DialogMessage(props: {
  messageID: string
  sessionID: string
  setPrompt?: (prompt: PromptInfo) => void
}) {
  const sync = useData()
  const sdk = useSDK()
  const message = createMemo(() => sync.instance.message(props.sessionID)?.find((x) => x.id === props.messageID))
  const route = useRoute()
  const clipboard = useClipboard()
  const toast = useToast()
  const locale = useLocale()

  return (
    <DialogSelect
      title={locale.t("dialog.messageActions")}
      options={[
        {
          title: locale.t("dialog.revert"),
          value: "session.revert",
          description: locale.t("dialog.revertDescription"),
          onSelect: (dialog) => {
            const msg = message()
            if (!msg) return

            void sdk.client.v2.session.revert.stage({
              sessionID: props.sessionID,
              messageID: msg.id,
            })

            if (props.setPrompt) {
              const parts = sync.instance.part(msg.id) ?? []
              const promptInfo = parts.reduce(
                (agg, part) => {
                  if (part.type === "text") {
                    if (!part.synthetic) agg.input += part.text
                  }
                  if (part.type === "file") agg.parts.push(stripPromptPartIDs(part))
                  return agg
                },
                { input: "", parts: [] as PromptInfo["parts"] },
              )
              props.setPrompt(promptInfo)
            }

            dialog.clear()
          },
        },
        {
          title: locale.t("dialog.copy"),
          value: "message.copy",
          description: locale.t("dialog.copyDescription"),
          onSelect: async (dialog) => {
            const msg = message()
            if (!msg) return

            const parts = sync.instance.part(msg.id) ?? []
            const text = parts.reduce((agg, part) => {
              if (part.type === "text" && !part.synthetic) {
                agg += part.text
              }
              return agg
            }, "")

            await clipboard.write?.(text)
            dialog.clear()
          },
        },
        {
          title: locale.t("dialog.fork"),
          value: "session.fork",
          description: locale.t("dialog.forkDescription"),
          onSelect: async (dialog) => {
            let forked
            try {
              forked = await sdk.client.v2.session.fork({
                sessionID: props.sessionID,
                atMessageID: props.messageID,
              })
            } catch {
              toast.show({ message: locale.t("error.forkFailed"), variant: "error" })
              return
            }
            if (!forked.data?.data) {
              toast.show({ message: locale.t("error.forkFailed"), variant: "error" })
              return
            }
            const msg = message()
            const prompt = msg
              ? (sync.instance.part(msg.id) ?? []).reduce(
                  (agg, part) => {
                    if (part.type === "text") {
                      if (!part.synthetic) agg.input += part.text
                    }
                    if (part.type === "file") agg.parts.push(part)
                    return agg
                  },
                  { input: "", parts: [] as PromptInfo["parts"] },
                )
              : undefined
            route.navigate({
              sessionID: forked.data.data,
              type: "session",
              prompt,
            })
            dialog.clear()
          },
        },
      ]}
    />
  )
}
