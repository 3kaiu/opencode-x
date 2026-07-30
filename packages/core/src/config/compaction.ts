export * as ConfigCompaction from "./compaction"

import { Schema } from "effect"
import { NonNegativeInt } from "../schema"

export class Keep extends Schema.Class<Keep>("ConfigV2.Compaction.Keep")({
  tokens: NonNegativeInt.pipe(Schema.optional),
}) {}

export class Levels extends Schema.Class<Levels>("ConfigV2.Compaction.Levels")({
  l2_trigger: Schema.Number.pipe(Schema.optional),
  l3_trigger: Schema.Number.pipe(Schema.optional),
  l4_trigger: Schema.Number.pipe(Schema.optional),
  l5_trigger: Schema.Number.pipe(Schema.optional),
  l1_max_chars: NonNegativeInt.pipe(Schema.optional),
}) {}

export class Info extends Schema.Class<Info>("ConfigV2.Compaction")({
  auto: Schema.Boolean.pipe(Schema.optional),
  prune: Schema.Boolean.pipe(Schema.optional),
  keep: Keep.pipe(Schema.optional),
  buffer: NonNegativeInt.pipe(Schema.optional),
  levels: Levels.pipe(Schema.optional),
}) {}
