export * as Agent from "./agent"

import { Schema } from "effect"
import { optional } from "./schema"
import { Model } from "./model"
import { Permission } from "./permission"
import { Provider } from "./provider"
import { PositiveInt, statics } from "./schema"

export const ID = Schema.String.pipe(Schema.brand("Agent.ID"))
export type ID = typeof ID.Type

export const Color = Schema.Union([
  Schema.String.check(Schema.isPattern(/^#[0-9a-fA-F]{6}$/)),
  Schema.Literals(["primary", "secondary", "accent", "success", "warning", "error", "info"]),
]).annotate({ identifier: "Agent.Color" })
export type Color = typeof Color.Type

export const ModelPreference = Schema.Struct({
  continuation: Model.Ref.pipe(optional),
})
  .annotate({ identifier: "Agent.ModelPreference" })
export interface ModelPreference extends Schema.Schema.Type<typeof ModelPreference> {}

export interface Info extends Schema.Schema.Type<typeof Info> {
  readonly model_preference?: ModelPreference
}
export const Info = Schema.Struct({
  id: ID,
  model: Model.Ref.pipe(optional),
  request: Provider.Request,
  system: Schema.String.pipe(optional),
  description: Schema.String.pipe(optional),
  mode: Schema.Literals(["subagent", "primary", "all"]),
  hidden: Schema.Boolean,
  color: Color.pipe(optional),
  steps: PositiveInt.pipe(optional),
  permissions: Permission.Ruleset,
  model_preference: ModelPreference.pipe(optional),
})
  .annotate({ identifier: "Agent.Info" })
  .pipe(
    statics((schema) => ({
      empty: (id: ID) =>
        schema.make({ id, request: { headers: {}, body: {} }, mode: "all", hidden: false, permissions: [] }),
    })),
  )
