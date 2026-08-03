export * as PluginHost from "./host"

import type { PluginContext as Interface } from "@opencode-ai/plugin/v2/effect"
import { EventManifest } from "@opencode-ai/schema/event-manifest"
import { Effect, Schema, Stream } from "effect"
import { AgentV2 } from "../agent"
import { AISDK } from "../aisdk"
import { Catalog } from "../catalog"
import { CommandV2 } from "../command"
import { Credential } from "../credential"
import { EventV2 } from "../event"
import { Integration } from "../integration"
import { ModelV2 } from "../model"
import { PluginV2 } from "../plugin"
import { ProviderV2 } from "../provider"
import { Reference } from "../reference"
import type { DeepMutable } from "../schema"
import { SessionHooks } from "../session/hooks"
import { SkillV2 } from "../skill"

const mutable = <T>(value: T) => value as DeepMutable<T>

export const make = Effect.fn("PluginHost.make")(function* (plugin: PluginV2.Interface) {
  const agents = yield* AgentV2.Service
  const aisdk = yield* AISDK.Service
  const catalog = yield* Catalog.Service
  const commands = yield* CommandV2.Service
  const events = yield* EventV2.Service
  const hooks = yield* SessionHooks.Service
  const integration = yield* Integration.Service
  const reference = yield* Reference.Service
  const skill = yield* SkillV2.Service

  return {
    options: {},
    agent: {
      reload: agents.reload,
      transform: (callback) =>
        agents.transform((draft) =>
          callback({
            list: () => mutable(draft.list()),
            get: (id) => mutable(draft.get(AgentV2.ID.make(id))),
            default: (id) => draft.default(id === undefined ? undefined : AgentV2.ID.make(id)),
            update: (id, update) => draft.update(AgentV2.ID.make(id), update),
            remove: (id) => draft.remove(AgentV2.ID.make(id)),
          }),
        ),
    },
    aisdk: {
      sdk: (callback) =>
        aisdk.hook.sdk((event) => {
          const output = {
            model: mutable(event.model),
            package: event.package,
            options: event.options,
            sdk: event.sdk,
          }
          const result = callback(output)
          return Effect.suspend(() => (Effect.isEffect(result) ? result : Effect.void)).pipe(
            Effect.tap(() => Effect.sync(() => (event.sdk = output.sdk))),
          )
        }),
      language: (callback) =>
        aisdk.hook.language((event) => {
          const output = {
            model: mutable(event.model),
            sdk: event.sdk,
            options: event.options,
            language: event.language,
          }
          const result = callback(output)
          return Effect.suspend(() => (Effect.isEffect(result) ? result : Effect.void)).pipe(
            Effect.tap(() => Effect.sync(() => (event.language = output.language))),
          )
        }),
    },
    catalog: {
      reload: catalog.reload,
      transform: (callback) =>
        catalog.transform((draft) =>
          callback({
            provider: {
              list: () => mutable(draft.provider.list()),
              get: (id) => mutable(draft.provider.get(ProviderV2.ID.make(id))),
              update: (id, update) => draft.provider.update(ProviderV2.ID.make(id), update),
              remove: (id) => draft.provider.remove(ProviderV2.ID.make(id)),
            },
            model: {
              get: (providerID, modelID) =>
                mutable(draft.model.get(ProviderV2.ID.make(providerID), ModelV2.ID.make(modelID))),
              update: (providerID, modelID, update) =>
                draft.model.update(ProviderV2.ID.make(providerID), ModelV2.ID.make(modelID), update),
              remove: (providerID, modelID) =>
                draft.model.remove(ProviderV2.ID.make(providerID), ModelV2.ID.make(modelID)),
              default: {
                get: draft.model.default.get,
                set: (providerID, modelID) =>
                  draft.model.default.set(ProviderV2.ID.make(providerID), ModelV2.ID.make(modelID)),
              },
            },
          }),
        ),
    },
    command: {
      reload: commands.reload,
      transform: commands.transform,
    },
    event: {
      // SDK event type strings are identical to the internal definition types, so
      // the public manifest resolves a subscription directly. A few SDK types (e.g.
      // server.instance.disposed) are not EventV2 definitions and never emit on the
      // durable bus; those hand back an empty stream. Payload data is encoded so
      // in-process subscribers receive the same shape as remote SDK consumers.
      subscribe: ((type: string) => {
        const definition = EventManifest.Latest.get(type)
        if (!definition) return Stream.empty
        return events.subscribe(definition).pipe(
          Stream.map((payload) => ({
            id: payload.id,
            type: payload.type,
            properties: Schema.encodeUnknownSync(definition.data)(payload.data),
          })),
          // Live events are published unvalidated; a single non-conforming
          // payload must not defect the whole subscription stream.
          Stream.catch((error) =>
            Effect.logWarning("plugin event subscription failed", { type, error }).pipe(Stream.fromEffect),
          ),
        )
      }) as Interface["event"]["subscribe"],
    },
    integration: {
      reload: integration.reload,
      connection: {
        active: (id) => integration.connection.active(Integration.ID.make(id)),
        resolve: (connection) =>
          integration.connection.resolve(
            connection.type === "credential" ? { ...connection, id: Credential.ID.make(connection.id) } : connection,
          ),
      },
      transform: (callback) =>
        integration.transform((draft) =>
          callback({
            list: () => mutable(draft.list()),
            get: (id) => mutable(draft.get(Integration.ID.make(id))),
            update: (id, update) => draft.update(Integration.ID.make(id), update),
            remove: (id) => draft.remove(Integration.ID.make(id)),
            method: {
              list: (id) => mutable(draft.method.list(Integration.ID.make(id))),
              update: (input) => {
                if ("authorize" in input) {
                  const methodID = Integration.MethodID.make(input.method.id)
                  const refresh = input.refresh
                  draft.method.update({
                    integrationID: Integration.ID.make(input.integrationID),
                    method: { ...input.method, id: methodID },
                    authorize: (inputs) =>
                      input.authorize(inputs).pipe(
                        Effect.map((authorization) => {
                          if (authorization.mode === "auto") {
                            return {
                              ...authorization,
                              callback: authorization.callback.pipe(
                                Effect.map((credential) =>
                                  Credential.OAuth.make({
                                    ...credential,
                                    methodID: Integration.MethodID.make(credential.methodID),
                                  }),
                                ),
                              ),
                            }
                          }
                          return {
                            ...authorization,
                            callback: (code: string) =>
                              authorization.callback(code).pipe(
                                Effect.map((credential) =>
                                  Credential.OAuth.make({
                                    ...credential,
                                    methodID: Integration.MethodID.make(credential.methodID),
                                  }),
                                ),
                              ),
                          }
                        }),
                      ),
                    ...(refresh
                      ? {
                          refresh: (value: Credential.OAuth) =>
                            refresh(value).pipe(
                              Effect.map((next) =>
                                Credential.OAuth.make({
                                  ...next,
                                  methodID: Integration.MethodID.make(next.methodID),
                                }),
                              ),
                            ),
                        }
                      : {}),
                    ...(input.label ? { label: input.label } : {}),
                  })
                  return
                }
                if (input.method.type === "env") {
                  draft.method.update({
                    integrationID: Integration.ID.make(input.integrationID),
                    method: { type: "env", names: input.method.names },
                  })
                  return
                }
                draft.method.update({
                  integrationID: Integration.ID.make(input.integrationID),
                  method: { type: "key", label: input.method.label },
                })
              },
              remove: (id, method) =>
                draft.method.remove(Integration.ID.make(id), Schema.decodeUnknownSync(Integration.Method)(method)),
            },
          }),
        ),
    },
    plugin: {
      add: (input) => plugin.add(PluginV2.ID.make(input.id), input.effect),
      remove: (id) => plugin.remove(PluginV2.ID.make(id)),
    },
    reference: {
      reload: reference.reload,
      transform: (callback) =>
        reference.transform((draft) =>
          callback({
            add: (name, source) => draft.add(name, Schema.decodeUnknownSync(Reference.Source)(source)),
            remove: draft.remove,
            list: draft.list,
          }),
        ),
    },
    skill: {
      reload: skill.reload,
      transform: (callback) =>
        skill.transform((draft) =>
          callback({
            source: (source) => draft.source(Schema.decodeUnknownSync(SkillV2.Source)(source)),
            list: draft.list,
          }),
        ),
    },
    tool: {
      // Bridges the public hook context onto the internal SessionHooks seam the
      // runner invokes around each tool settlement. before-hooks may rewrite args,
      // deny, or skip; after-hooks may append context to the tool result.
      hook: ((name: string, callback: (event: unknown) => Effect.Effect<void>) => {
        if (name === "execute.before") {
          return hooks.registerPreToolUse((tool) =>
            Effect.gen(function* () {
              let input = tool.input
              let denied: string | undefined
              let skipped = false
              // A throwing hook must not fail the runner's pre-tool settlement;
              // degrade to allow so a buggy plugin can't deny every tool call.
              yield* callback({
                name: tool.name,
                input: tool.input,
                args: {
                  update: (next: unknown) => {
                    input = next
                  },
                },
                deny: (reason: string) => {
                  denied = reason
                },
                skip: () => {
                  skipped = true
                },
              }).pipe(
                Effect.tapError((error) =>
                  Effect.logWarning("plugin tool before-hook failed; allowing tool call", { error }),
                ),
                Effect.ignore,
              )
              if (denied !== undefined) return { action: "deny" as const, reason: denied }
              if (skipped) return { action: "skip" as const }
              return input === tool.input
                ? { action: "allow" as const }
                : { action: "allow" as const, modifiedInput: input }
            }),
          )
        }
        if (name === "execute.after") {
          return hooks.registerPostToolUse((tool) =>
            Effect.gen(function* () {
              const parts: string[] = []
              // A throwing after-hook must not discard an already-settled tool
              // result; log and continue with the successful tool output.
              yield* callback({
                name: tool.name,
                input: tool.input,
                output: tool.output,
                context: {
                  add: (text: string) => {
                    parts.push(text)
                  },
                },
              }).pipe(
                Effect.tapError((error) =>
                  Effect.logWarning("plugin tool after-hook failed; keeping tool result", { error }),
                ),
                Effect.ignore,
              )
              return parts.length
                ? { action: "continue" as const, additionalContext: parts.join("\n") }
                : { action: "continue" as const }
            }),
          )
        }
        // Unknown hook names must not silently bridge to a different seam (e.g. a
        // typo'd "execute.before" landing on the post hook). Warn and no-op.
        return Effect.logWarning("Unknown tool hook name; ignoring", { name }).pipe(Effect.asVoid)
      }) as Interface["tool"]["hook"],
    },
    turn: {
      // Bridges turn lifecycle hooks (Claude Code UserPromptSubmit/Stop) onto
      // the runner's turn boundaries. before-hooks may add feedback that is
      // injected into the system layer; after-hooks observe the stop reason.
      hook: ((name: string, callback: (event: unknown) => Effect.Effect<void>) => {
        if (name === "before") {
          return hooks.registerTurnStart((turn) =>
            Effect.gen(function* () {
              const feedback: string[] = []
              yield* callback({
                prompt: turn.prompt,
                feedback: {
                  add: (text: string) => {
                    feedback.push(text)
                  },
                },
              }).pipe(
                Effect.tapError((error) =>
                  Effect.logWarning("plugin turn before-hook failed; continuing turn", { error }),
                ),
                Effect.ignore,
              )
              return feedback.length > 0
                ? { action: "block" as const, feedback: feedback.join("\n") }
                : { action: "continue" as const }
            }),
          )
        }
        if (name === "after") {
          return hooks.registerTurnStop((turn) =>
            callback({ prompt: turn.prompt, stopReason: turn.stopReason }).pipe(
              Effect.tapError((error) => Effect.logWarning("plugin turn after-hook failed", { error })),
              Effect.ignore,
            ),
          )
        }
        return Effect.logWarning("Unknown turn hook name; ignoring", { name }).pipe(Effect.asVoid)
      }) as Interface["turn"]["hook"],
    },
  } satisfies Interface
})
