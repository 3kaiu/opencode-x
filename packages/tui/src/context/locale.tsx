import { createMemo } from "solid-js"
import { useData } from "./data"
import { createSimpleContext } from "./helper"
import { translate, type I18NKey, type Locale } from "../util/i18n"

export const { use: useLocale, provider: LocaleProvider } = createSimpleContext({
  name: "Locale",
  init(input: { locale?: Locale }) {
    const sync = input.locale ? undefined : useData()
    const locale = createMemo<Locale>(() => {
      if (input.locale) return input.locale
      const config = sync!.instance.config
      return "locale" in config && config.locale === "zh" ? "zh" : "en"
    })
    return {
      get locale() {
        return locale()
      },
      t(key: I18NKey, params?: Record<string, string | number>) {
        return translate(locale(), key, params)
      },
    }
  },
})