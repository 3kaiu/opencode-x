export * as SessionFork from "./fork"

import { and, eq, lte } from "drizzle-orm"
import { Effect } from "effect"
import { Database } from "../database/database"
import { SessionSchema } from "./schema"
import { SessionMessage } from "./message"
import { SessionMessageTable, SessionTable } from "./sql"

export interface ForkInput {
  readonly sessionID: SessionSchema.ID
  /** Fork at this message ID (inclusive). Defaults to the latest message. */
  readonly atMessageID?: SessionMessage.ID
}

export interface ForkResult {
  readonly sessionID: SessionSchema.ID
  readonly messageCount: number
}

/**
 * Snapshot-fork a session: create a new session with the projected messages
 * of the original up to the fork point. The new session starts a fresh event
 * stream — pre-fork event history is NOT copied (by design: the fork is a
 * clean break, not a git branch).
 *
 * The `parentID` field on the new session records the fork origin.
 */
export const fork = Effect.fn("SessionFork.fork")(function* (input: ForkInput) {
  const { db } = yield* Database.Service

  const original = yield* db
    .select()
    .from(SessionTable)
    .where(eq(SessionTable.id, input.sessionID))
    .get()
    .pipe(Effect.orDie)
  if (!original) return yield* Effect.die(`Session not found: ${input.sessionID}`)

  const newID = SessionSchema.ID.create()
  const now = Date.now()

  yield* db
    .insert(SessionTable)
    .values({
      ...original,
      id: newID,
      parent_id: original.id,
      title: `${original.title} (fork)`,
      cost: 0,
      tokens_input: 0,
      tokens_output: 0,
      tokens_reasoning: 0,
      tokens_cache_read: 0,
      tokens_cache_write: 0,
      share_url: null,
      revert: null,
      time_created: now,
      time_updated: now,
      time_compacting: null,
      time_archived: null,
    })
    .pipe(Effect.orDie)

  // Determine the fork boundary seq
  let maxSeq: number | undefined
  if (input.atMessageID) {
    const boundary = yield* db
      .select({ seq: SessionMessageTable.seq })
      .from(SessionMessageTable)
      .where(
        and(
          eq(SessionMessageTable.session_id, input.sessionID),
          eq(SessionMessageTable.id, input.atMessageID),
        ),
      )
      .get()
      .pipe(Effect.orDie)
    maxSeq = boundary?.seq
  }

  const messages = yield* db
    .select()
    .from(SessionMessageTable)
    .where(
      maxSeq !== undefined
        ? and(
            eq(SessionMessageTable.session_id, input.sessionID),
            lte(SessionMessageTable.seq, maxSeq),
          )
        : eq(SessionMessageTable.session_id, input.sessionID),
    )
    .all()
    .pipe(Effect.orDie)

  if (messages.length > 0) {
    yield* db
      .insert(SessionMessageTable)
      .values(messages.map((row) => ({ ...row, session_id: newID })))
      .pipe(Effect.orDie)
  }

  return { sessionID: newID, messageCount: messages.length }
})
