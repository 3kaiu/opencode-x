export * as SessionWire from "./wire"

import { DateTime, Effect, Schema } from "effect"
import { Model } from "@opencode-ai/schema/model"
import { Provider } from "@opencode-ai/schema/provider"
import { SessionEvent } from "./event"
import { SessionMessage } from "./message"
import { SessionMessageUpdater } from "./message-updater"

// Wire record types - all context mutations are recorded as replayable entries.
// Built on top of EventV2 durable events; wire records are a projection-friendly
// serialization format, not a replacement for the event store.

export const Record = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("message"),
    seq: Schema.Number,
    message: SessionMessage.Message,
  }),
  Schema.Struct({
    type: Schema.Literal("compaction"),
    seq: Schema.Number,
    summary: Schema.String,
    recent: Schema.String,
  }),
  Schema.Struct({
    type: Schema.Literal("context_injection"),
    seq: Schema.Number,
    source: Schema.String,
    content: Schema.String,
  }),
  Schema.Struct({
    type: Schema.Literal("model_switch"),
    seq: Schema.Number,
    providerID: Schema.String,
    modelID: Schema.String,
  }),
  Schema.Struct({
    type: Schema.Literal("agent_switch"),
    seq: Schema.Number,
    agent: Schema.String,
  }),
])
export type Record = typeof Record.Type

export type WireRecord = Record

// Convert a durable session event into a wire record, if applicable.
// Non-replayable or streaming-only events return undefined.
export const fromDurableEvent = (event: SessionEvent.DurableEvent): WireRecord | undefined => {
  const seq = event.durable?.seq ?? 0
  switch (event.type) {
    case "session.next.prompted":
      return {
        type: "message",
        seq,
        message: SessionMessage.User.make({
          id: event.data.messageID,
          type: "user",
          text: event.data.prompt.text,
          files: event.data.prompt.files,
          agents: event.data.prompt.agents,
          time: { created: event.data.timestamp },
        }),
      }
    case "session.next.context.updated":
      return {
        type: "context_injection",
        seq,
        source: "context",
        content: event.data.text,
      }
    case "session.next.model.switched":
      return {
        type: "model_switch",
        seq,
        providerID: event.data.model.providerID,
        modelID: event.data.model.id,
      }
    case "session.next.agent.switched":
      return {
        type: "agent_switch",
        seq,
        agent: event.data.agent,
      }
    case "session.next.compaction.ended":
      return {
        type: "compaction",
        seq,
        summary: event.data.text,
        recent: event.data.recent,
      }
    default:
      return undefined
  }
}

// Replay a session's message list from an ordered sequence of wire records.
// Returns the projected message array.
export const replaySession = (records: readonly WireRecord[]): SessionMessage.Message[] => {
  const state: SessionMessageUpdater.MemoryState = { messages: [] }
  const adapter = SessionMessageUpdater.memory(state)
  Effect.runSync(
    Effect.forEach(records, (record) => {
      switch (record.type) {
        case "compaction":
          return adapter.appendMessage(
            SessionMessage.Compaction.make({
              id: SessionMessage.ID.create(),
              type: "compaction",
              reason: "manual",
              summary: record.summary,
              recent: record.recent,
              time: { created: DateTime.fromDateUnsafe(new Date(0)) },
            }),
          )
        case "context_injection":
          return adapter.appendMessage(
            SessionMessage.System.make({
              id: SessionMessage.ID.create(),
              type: "system",
              text: record.content,
              time: { created: DateTime.fromDateUnsafe(new Date(0)) },
            }),
          )
        case "message":
          return adapter.appendMessage(record.message)
        case "model_switch":
          return adapter.appendMessage(
            SessionMessage.ModelSwitched.make({
              id: SessionMessage.ID.create(),
              type: "model-switched",
              model: { id: record.modelID as Model.ID, providerID: record.providerID as Provider.ID },
              time: { created: DateTime.fromDateUnsafe(new Date(0)) },
            }),
          )
        case "agent_switch":
          return adapter.appendMessage(
            SessionMessage.AgentSwitched.make({
              id: SessionMessage.ID.create(),
              type: "agent-switched",
              agent: record.agent,
              time: { created: DateTime.fromDateUnsafe(new Date(0)) },
            }),
          )
      }
    }, { discard: true }),
  )
  return state.messages
}

// Fork a wire record sequence at a specific sequence number.
// Returns a new array of records up to and including the fork point.
// This is a shallow copy - records reference the same data objects.
export const forkRecords = (
  records: readonly WireRecord[],
  atSeq: number,
): WireRecord[] => {
  return records.filter((record) => record.seq <= atSeq).slice()
}
