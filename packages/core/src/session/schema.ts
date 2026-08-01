export * as SessionSchema from "./schema"

import { Session } from "@opencode-ai/schema/session"

export const ID = Session.ID
export type ID = typeof ID.Type

export const Info = Session.Info
export type Info = Session.Info

const defaultTitlePattern =
  /^(New session|Child session) - \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

/** True for placeholder titles assigned at Session creation before the first user prompt. */
export const isDefaultTitle = (title: string) => defaultTitlePattern.test(title)
