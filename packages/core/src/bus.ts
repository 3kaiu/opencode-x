import { Cause, Context, Effect, Layer, Option, PubSub, Queue, Schema, Stream } from "effect"
import { Event } from "@opencode-ai/schema/event"
import type { Data, Definition, Payload } from "@opencode-ai/schema/event"
import { and, asc, eq, gt, inArray } from "drizzle-orm"
import { Database } from "./database/database"
import { EventSequenceTable, EventTable } from "./event/sql"
import { Location } from "./location"
import { makeGlobalNode } from "./effect/app-node"
import { isDeepStrictEqual } from "node:util"
import { Durable } from "@opencode-ai/schema/durable-event-manifest"

export const ID = Event.ID
export type ID = import("@opencode-ai/schema/event").ID
export type { Data, Definition, Payload } from "@opencode-ai/schema/event"

export type Subscriber<D extends Definition = Definition> = (event: Payload<D>) => Effect.Effect<void>
export type Unsubscribe = Effect.Effect<void>

export const latestSequence = Effect.fn("EventV2.latestSequence")(function* (
  db: Database.Interface["db"],
  aggregateID: string,
) {
  const row = yield* db
    .select({ seq: EventSequenceTable.seq })
    .from(EventSequenceTable)
    .where(eq(EventSequenceTable.aggregate_id, aggregateID))
    .get()
    .pipe(Effect.orDie)
  return row?.seq ?? -1
})

/**
 * Advances the durable aggregate sequence to `seq` so subsequent publishes continue from
 * `seq + 1`. Used when a session is populated out-of-band (for example forking a projection copy
 * of messages) and the next durable event must not collide with the copied sequence range.
 */
export const advanceSequence = Effect.fn("EventV2.advanceSequence")(function* (
  db: Database.Interface["db"],
  aggregateID: string,
  seq: number,
) {
  yield* db
    .insert(EventSequenceTable)
    .values({ aggregate_id: aggregateID, seq })
    .onConflictDoUpdate({
      target: EventSequenceTable.aggregate_id,
      set: { seq },
    })
    .run()
    .pipe(Effect.orDie)
})

export type SerializedEvent = {
  readonly id: ID
  readonly type: string
  readonly seq: number
  readonly aggregateID: string
  readonly data: Record<string, unknown>
}

export class InvalidDurableEventError extends Schema.TaggedErrorClass<InvalidDurableEventError>()(
  "EventV2.InvalidDurableEvent",
  {
    type: Schema.String,
    message: Schema.String,
  },
) {}

const decodeSerializedEvent = (event: SerializedEvent): Payload => {
  const definition = Durable.get(event.type)
  if (!definition?.durable) {
    throw new InvalidDurableEventError({ type: event.type, message: `Unknown durable event type ${event.type}` })
  }
  return {
    id: event.id,
    type: definition.type,
    durable: { aggregateID: event.aggregateID, seq: event.seq, version: definition.durable.version },
    data: Schema.decodeUnknownSync(definition.data)(event.data),
  }
}

export const readAggregate = Effect.fn("EventV2.readAggregate")(function* <A>(
  db: Database.Interface["db"],
  input: {
    readonly aggregateID: string
    readonly after?: number
    readonly limit: number
    readonly manifest: {
      readonly definitions: ReadonlyMap<string, Definition>
      readonly schema: Schema.Decoder<A, never>
    }
  },
) {
  const after = input.after ?? -1
  const rows = yield* db
    .select()
    .from(EventTable)
    .where(
      and(
        eq(EventTable.aggregate_id, input.aggregateID),
        gt(EventTable.seq, after),
        inArray(EventTable.type, Array.from(input.manifest.definitions.keys())),
      ),
    )
    .orderBy(asc(EventTable.seq))
    .limit(input.limit + 1)
    .all()
    .pipe(Effect.orDie)
  const page = rows.slice(0, input.limit)
  const decode = Schema.decodeUnknownSync(input.manifest.schema)
  const events = page.map((event) =>
    decode({
      id: event.id,
      type: input.manifest.definitions.get(event.type)?.type ?? event.type,
      durable: {
        aggregateID: event.aggregate_id,
        seq: event.seq,
        version: input.manifest.definitions.get(event.type)?.durable?.version,
      },
      data: event.data,
    }),
  )
  return {
    events,
    hasMore: rows.length > input.limit,
  }
})


export const define = Event.define
export const versionedType = Event.versionedType

export interface PublishOptions {
  readonly id?: ID
  readonly metadata?: Record<string, unknown>
  readonly location?: Location.Ref
  /** Local operational projection committed atomically with a new durable event. Not replayed or serialized. */
  readonly commit?: (seq: number) => Effect.Effect<void>
}

export interface Interface {
  readonly publish: <D extends Definition>(
    definition: D,
    data: Data<D>,
    options?: PublishOptions,
  ) => Effect.Effect<Payload<D>>
  readonly subscribe: <D extends Definition>(definition: D) => Stream.Stream<Payload<D>>
  readonly all: () => Stream.Stream<Payload>
  readonly durable: (input: { readonly aggregateID: string; readonly after?: number }) => Stream.Stream<Payload>
  /** @deprecated Use `all()` and consume the returned stream. */
  readonly listen: (listener: Subscriber) => Effect.Effect<Unsubscribe>
  readonly project: <D extends Definition>(definition: D, projector: Subscriber<D>) => Effect.Effect<void>
  readonly replay: (
    event: SerializedEvent,
    options?: { readonly publish?: boolean; readonly ownerID?: string; readonly strictOwner?: boolean },
  ) => Effect.Effect<void>
  readonly replayAll: (
    events: SerializedEvent[],
    options?: { readonly publish?: boolean; readonly ownerID?: string; readonly strictOwner?: boolean },
  ) => Effect.Effect<string | undefined>
  readonly remove: (aggregateID: string) => Effect.Effect<void>
  readonly claim: (aggregateID: string, ownerID: string) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Event") {}

export const allBounded = (events: Interface, capacity: number) =>
  Effect.gen(function* () {
    const queue = yield* Queue.dropping<Payload>(capacity)
    const unsubscribe = yield* events.listen((event) =>
      Queue.offer(queue, event).pipe(
        Effect.flatMap((accepted) =>
          accepted ? Effect.void : Effect.logWarning("event subscriber overflow; dropping live event"),
        ),
      ),
    )
    yield* Effect.addFinalizer(() => unsubscribe.pipe(Effect.andThen(Queue.shutdown(queue)), Effect.asVoid))
    return Stream.fromQueue(queue)
  })

export interface LayerOptions {
  readonly beforeAggregateRead?: (aggregateID: string) => Effect.Effect<void>
}

export const layerWith = (options?: LayerOptions) =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const pubsub = {
        // Sliding, not unbounded: no production consumer reads `all()` (only tests
        // exercise the wildcard stream), so an unbounded channel accumulates every live
        // event for the process lifetime. A sliding channel retains the most recent
        // event for late subscribers while bounding memory.
        all: yield* PubSub.sliding<Payload>(1),
        durable: new Map<string, Set<PubSub.PubSub<void>>>(),
        typed: new Map<string, PubSub.PubSub<Payload>>(),
      }
      const projectors = new Map<string, Subscriber[]>()
      // TODO: Bind durable projectors to exact type+version before supporting incompatible historical payloads.
      const listeners = new Array<Subscriber>()
      const { db } = yield* Database.Service

      const getOrCreate = (definition: Definition) =>
        Effect.gen(function* () {
          const existing = pubsub.typed.get(definition.type)
          if (existing) return existing
          const created = yield* PubSub.unbounded<Payload>()
          pubsub.typed.set(definition.type, created)
          return created
        })

      yield* Effect.addFinalizer(() =>
        Effect.gen(function* () {
          yield* PubSub.shutdown(pubsub.all)
          yield* Effect.forEach(
            pubsub.durable.values(),
            (pubsubs) => Effect.forEach(pubsubs, PubSub.shutdown, { discard: true }),
            { discard: true },
          )
          yield* Effect.forEach(pubsub.typed.values(), PubSub.shutdown, { discard: true })
        }),
      )

      function commitDurableEvent(
        definition: Definition,
        event: Payload,
        input?: {
          readonly seq: number
          readonly aggregateID: string
          readonly ownerID?: string
          readonly strictOwner?: boolean
        },
        commit?: (seq: number) => Effect.Effect<void>,
      ) {
        return Effect.gen(function* () {
          const durable = definition?.durable
          if (!durable) return
          const aggregateID = (event.data as Record<string, unknown>)[durable.aggregate]
          if (typeof aggregateID !== "string")
            return yield* Effect.die(
              new InvalidDurableEventError({
                type: event.type,
                message: `Expected string aggregate field ${durable.aggregate}`,
              }),
            )
          if (input && input.aggregateID !== aggregateID)
            return yield* Effect.die(
              new InvalidDurableEventError({
                type: event.type,
                message: `Aggregate mismatch: expected ${input.aggregateID}, got ${aggregateID}`,
              }),
            )
          const list = projectors.get(event.type) ?? []
          return yield* Effect.uninterruptible(
            Effect.gen(function* () {
              const committed = yield* db
                .transaction(() => commitTransaction(definition, durable, event, aggregateID, list, input, commit), {
                  behavior: "immediate",
                })
                .pipe(Effect.orDie)
              if (committed) {
                yield* Effect.forEach(
                  pubsub.durable.get(committed.aggregateID) ?? [],
                  (wake) => PubSub.publish(wake, undefined),
                  { discard: true },
                )
              }
              return committed
            }),
          )
        })
      }

      function commitTransaction(        definition: Definition,
        durable: NonNullable<Definition["durable"]>,
        event: Payload,
        aggregateID: string,
        list: Subscriber[],
        input?: {
          readonly seq: number
          readonly aggregateID: string
          readonly ownerID?: string
          readonly strictOwner?: boolean
        },
        commit?: (seq: number) => Effect.Effect<void>,
      ) {
        return Effect.gen(function* () {
          const row = yield* db
            .select({ seq: EventSequenceTable.seq, ownerID: EventSequenceTable.owner_id })
            .from(EventSequenceTable)
            .where(eq(EventSequenceTable.aggregate_id, aggregateID))
            .get()
            .pipe(Effect.orDie)
          const latest = row?.seq ?? -1
          const encoded = Schema.encodeUnknownSync(definition.data)(event.data) as Record<string, unknown>
          if (input?.strictOwner && row?.ownerID && row.ownerID !== input.ownerID) {
            yield* Effect.die(
              new InvalidDurableEventError({
                type: event.type,
                message: `Replay owner mismatch for aggregate ${aggregateID}: expected ${row.ownerID}, got ${input.ownerID ?? "none"}`,
              }),
            )
          }
          if (input && input.seq <= latest)
            return yield* reconcileReplay(definition, durable, event, aggregateID, input, encoded, row?.ownerID)
          if (input && row?.ownerID && row.ownerID !== input.ownerID) {
            return
          }
          const seq = input?.seq ?? latest + 1
          if (input && seq !== latest + 1) {
            yield* Effect.die(
              new InvalidDurableEventError({
                type: event.type,
                message: `Sequence mismatch for aggregate ${aggregateID}: expected ${latest + 1}, got ${seq}`,
              }),
            )
          }
          const stored = yield* db
            .select({ aggregateID: EventTable.aggregate_id, seq: EventTable.seq })
            .from(EventTable)
            .where(eq(EventTable.id, event.id))
            .get()
            .pipe(Effect.orDie)
          if (stored)
            yield* Effect.die(
              new InvalidDurableEventError({
                type: event.type,
                message: `Event ${event.id} already exists at aggregate ${stored.aggregateID} sequence ${stored.seq}`,
              }),
            )
          const committed = {
            ...event,
            durable: { aggregateID, seq, version: durable.version },
          } as Payload
          for (const projector of list) {
            yield* projector(committed)
          }
          if (commit) yield* commit(seq)
          yield* db
            .insert(EventSequenceTable)
            .values([{ aggregate_id: aggregateID, seq, owner_id: input?.ownerID }])
            .onConflictDoUpdate({
              target: EventSequenceTable.aggregate_id,
              set: {
                seq,
                ...(input?.ownerID && row?.ownerID == null ? { owner_id: input.ownerID } : {}),
              },
            })
            .run()
            .pipe(Effect.orDie)
          yield* db
            .insert(EventTable)
            .values([
              {
                id: event.id,
                aggregate_id: aggregateID,
                seq,
                type: versionedType(definition.type, durable.version),
                data: encoded,
              },
            ])
            .run()
            .pipe(Effect.orDie)
          return { aggregateID, seq }
        })
      }

      function reconcileReplay(
        definition: Definition,
        durable: NonNullable<Definition["durable"]>,
        event: Payload,
        aggregateID: string,
        input: { readonly seq: number; readonly ownerID?: string },
        encoded: Record<string, unknown>,
        ownerID: string | null | undefined,
      ) {
        return Effect.gen(function* () {
          const stored = yield* db
            .select()
            .from(EventTable)
            .where(and(eq(EventTable.aggregate_id, aggregateID), eq(EventTable.seq, input.seq)))
            .get()
            .pipe(Effect.orDie)
          if (
            stored?.id === event.id &&
            stored.type === versionedType(definition.type, durable.version) &&
            isDeepStrictEqual(stored.data, encoded)
          ) {
            if (input.ownerID && ownerID == null) {
              yield* db
                .update(EventSequenceTable)
                .set({ owner_id: input.ownerID })
                .where(eq(EventSequenceTable.aggregate_id, aggregateID))
                .run()
                .pipe(Effect.orDie)
            }
            return
          }
          yield* Effect.die(
            new InvalidDurableEventError({
              type: event.type,
              message: `Replay diverged at aggregate ${aggregateID} sequence ${input.seq}`,
            }),
          )
        })
      }

      function publishEvent<D extends Definition>(definition: D, event: Payload<D>, commit?: PublishOptions["commit"]) {
        return Effect.gen(function* () {
          if (!definition?.durable && commit)
            return yield* Effect.die(
              new InvalidDurableEventError({
                type: event.type,
                message: "Local commit hooks require a durable event",
              }),
            )
          if (definition?.durable) {
            const committed = yield* commitDurableEvent(definition, event as Payload, undefined, commit)
            if (committed) {
              event = {
                ...event,
                durable: {
                  aggregateID: committed.aggregateID,
                  seq: committed.seq,
                  version: definition.durable.version,
                },
              }
              yield* notify(definition, event as Payload, true)
              return event
            }
          }
          yield* notify(definition, event as Payload, false)
          return event
        })
      }

      const observe = (event: Payload, observer: (event: Payload) => Effect.Effect<void>) =>
        Effect.suspend(() => observer(event)).pipe(
          Effect.catchCauseIf(
            (cause) => !Cause.hasInterrupts(cause),
            (cause) => Effect.logError("Event listener failed", { eventID: event.id, eventType: event.type, cause }),
          ),
        )

      function notify(definition: Definition, event: Payload, isolateListeners: boolean) {
        return Effect.gen(function* () {
          yield* Effect.forEach(
            listeners,
            (listener) => (isolateListeners ? observe(event, listener) : listener(event)),
            { discard: true },
          )
          // Ensure the typed channel exists before publishing so an event published before the
          // first subscriber attaches is buffered and delivered to it, rather than dropped. This
          // matches the unbounded `all` channel: subscribers observe everything published.
          const typed = yield* getOrCreate(definition)
          yield* PubSub.publish(typed, event)
          yield* PubSub.publish(pubsub.all, event)
        })
      }

      function publish<D extends Definition>(definition: D, data: Data<D>, options?: PublishOptions) {
        return Effect.gen(function* () {
          const serviceLocation = Option.getOrUndefined(yield* Effect.serviceOption(Location.Service))
          const location =
            options?.location ??
            (serviceLocation
              ? { directory: serviceLocation.directory, workspaceID: serviceLocation.workspaceID }
              : undefined)
          return yield* publishEvent(
            definition,
            {
              id: options?.id ?? ID.create(),
              ...(options?.metadata ? { metadata: options.metadata } : {}),
              type: definition.type,
              ...(location ? { location } : {}),
              data,
            } as Payload<D>,
            options?.commit,
          )
        })
      }

      function replay(
        event: SerializedEvent,
        options?: { readonly publish?: boolean; readonly ownerID?: string; readonly strictOwner?: boolean },
      ) {
        return Effect.gen(function* () {
          const definition = Durable.get(event.type)
          if (!definition?.durable) {
            yield* Effect.die(
              new InvalidDurableEventError({ type: event.type, message: `Unknown durable event type ${event.type}` }),
            )
          } else {
            const payload = {
              id: event.id,
              type: definition.type,
              data: Schema.decodeUnknownSync(definition.data)(event.data),
            } as Payload
            const committed = yield* commitDurableEvent(definition, payload, {
              seq: event.seq,
              aggregateID: event.aggregateID,
              ownerID: options?.ownerID,
              strictOwner: options?.strictOwner,
            })
            if (committed && options?.publish) {
              yield* notify(
                definition,
                {
                  ...payload,
                  durable: {
                    aggregateID: committed.aggregateID,
                    seq: committed.seq,
                    version: definition.durable.version,
                  },
                },
                true,
              )
            }
          }
        })
      }

      function replayAll(
        events: SerializedEvent[],
        options?: { readonly publish?: boolean; readonly ownerID?: string; readonly strictOwner?: boolean },
      ) {
        return Effect.gen(function* () {
          const source = events[0]?.aggregateID
          if (!source) return undefined
          if (events.some((event) => event.aggregateID !== source)) {
            yield* Effect.die(
              new InvalidDurableEventError({
                type: events[0]?.type ?? "unknown",
                message: "Replay events must belong to the same aggregate",
              }),
            )
          }
          const start = events[0]?.seq ?? 0
          for (const [index, event] of events.entries()) {
            const seq = start + index
            if (event.seq !== seq) {
              yield* Effect.die(
                new InvalidDurableEventError({
                  type: event.type,
                  message: `Replay sequence mismatch at index ${index}: expected ${seq}, got ${event.seq}`,
                }),
              )
            }
          }
          for (const event of events) {
            yield* replay(event, options)
          }
          return source
        })
      }

      function remove(aggregateID: string) {
        return db
          .transaction(() =>
            Effect.gen(function* () {
              yield* db.delete(EventSequenceTable).where(eq(EventSequenceTable.aggregate_id, aggregateID)).run()
              yield* db.delete(EventTable).where(eq(EventTable.aggregate_id, aggregateID)).run()
            }),
          )
          .pipe(Effect.orDie)
      }

      function claim(aggregateID: string, ownerID: string) {
        return db
          .update(EventSequenceTable)
          .set({ owner_id: ownerID })
          .where(eq(EventSequenceTable.aggregate_id, aggregateID))
          .run()
          .pipe(Effect.orDie)
      }

      const subscribe = <D extends Definition>(definition: D): Stream.Stream<Payload<D>> =>
        Stream.unwrap(getOrCreate(definition).pipe(Effect.map((pubsub) => Stream.fromPubSub(pubsub)))).pipe(
          Stream.map((event) => event as Payload<D>),
        )

      const streamAll = (): Stream.Stream<Payload> => Stream.fromPubSub(pubsub.all)

      const readAfter = (aggregateID: string, after: number, limit?: number) => {
        const query = db
          .select()
          .from(EventTable)
          .where(and(eq(EventTable.aggregate_id, aggregateID), gt(EventTable.seq, after)))
          .orderBy(asc(EventTable.seq))
        const withLimit = limit === undefined ? query : query.limit(limit)
        return (options?.beforeAggregateRead?.(aggregateID) ?? Effect.void).pipe(
          Effect.andThen(withLimit.all()),
          Effect.orDie,
          Effect.map((rows) =>
            rows.map((event) =>
              decodeSerializedEvent({
                id: event.id,
                aggregateID: event.aggregate_id,
                seq: event.seq,
                type: event.type,
                data: event.data,
              }),
            ),
          ),
        )
      }

      const subscribeDurable = (aggregateID: string) =>
        Effect.gen(function* () {
          const wake = yield* PubSub.sliding<void>(1)
          const subscription = yield* PubSub.subscribe(wake)
          yield* Effect.acquireRelease(
            Effect.sync(() => {
              const wakes = pubsub.durable.get(aggregateID) ?? new Set()
              wakes.add(wake)
              pubsub.durable.set(aggregateID, wakes)
            }),
            () =>
              Effect.sync(() => {
                const wakes = pubsub.durable.get(aggregateID)
                wakes?.delete(wake)
                if (wakes?.size === 0) pubsub.durable.delete(aggregateID)
              }).pipe(Effect.andThen(PubSub.shutdown(wake))),
          )
          return subscription
        })

      const durable = (input: { readonly aggregateID: string; readonly after?: number }): Stream.Stream<Payload> =>
        Stream.unwrap(
          Effect.gen(function* () {
            const wakes = yield* subscribeDurable(input.aggregateID)
            let sequence = input.after ?? -1
            // Page the durable history so a long session does not materialize its entire
            // aggregate in memory on every subscription. The wake subscription is acquired
            // first (above), so live commits during the paged replay are not lost; the live
            // path below re-reads from `sequence` on each wake, so paging is safe.
            const pageSize = 1000
            const historical = Stream.paginate(sequence, (from) =>
              readAfter(input.aggregateID, from, pageSize).pipe(
                Effect.map((events) => {
                  if (events.length === 0) return [events, Option.none<number>()] as const
                  const last = events[events.length - 1]
                  // Advance the shared cursor so the live path resumes after the paged
                  // history instead of re-reading (and duplicating) events it already
                  // emitted. `sequence` is only advanced when a full page was read; the
                  // final partial page leaves it at the last emitted seq.
                  sequence = last.durable?.seq ?? sequence
                  const next = events.length < pageSize ? Option.none<number>() : Option.some(sequence)
                  return [events, next] as const
                }),
              ),
            )
            const read = Effect.suspend(() => readAfter(input.aggregateID, sequence)).pipe(
              Effect.tap((events) =>
                Effect.sync(() => {
                  sequence = events.at(-1)?.durable?.seq ?? sequence
                }),
              ),
            )
            const live = Stream.fromSubscription(wakes).pipe(
              Stream.mapEffect(() => read),
              Stream.flattenIterable,
            )
            return Stream.concat(historical, live)
          }),
        )

      const listen = (listener: Subscriber): Effect.Effect<Unsubscribe> =>
        Effect.sync(() => {
          listeners.push(listener)
          return Effect.sync(() => {
            const index = listeners.indexOf(listener)
            if (index >= 0) listeners.splice(index, 1)
          })
        })

      const project = <D extends Definition>(definition: D, projector: Subscriber<D>): Effect.Effect<void> =>
        Effect.sync(() => {
          const list = projectors.get(definition.type) ?? []
          list.push((event) => projector(event as Payload<D>))
          projectors.set(definition.type, list)
        })

      return Service.of({
        publish,
        subscribe,
        all: streamAll,
        durable,
        listen,
        project,
        replay,
        replayAll,
        remove,
        claim,
      })
    }),
  )

const layer = layerWith()
export const node = makeGlobalNode({ service: Service, layer: layer, deps: [Database.node] })
