export * as ToolRegistry from "./registry"

import { ToolOutput, ToolDefinition, type ToolCall, type ToolResultValue } from "@opencode-ai/llm"
import { Context, Effect, Layer, Ref, Scope } from "effect"
import { AgentV2 } from "../agent"
import { PermissionV2 } from "../permission"
import { SessionMessage } from "../session/message"
import { SessionSchema } from "../session/schema"
import { ToolOutputStore } from "../tool-output-store"
import { Wildcard } from "../util/wildcard"
import { ApplicationTools } from "./application-tools"
import {
  definition,
  fullSchemaRecord,
  isDeferred,
  pathFilterOf,
  permission,
  settle,
  validateName,
  type AnyTool,
  type RegistrationError,
} from "./tool"
import { Tools } from "./tools"
import { makeLocationNode } from "../effect/app-node"

export type ExecuteInput = {
  readonly sessionID: SessionSchema.ID
  readonly agent: AgentV2.ID
  readonly assistantMessageID: SessionMessage.ID
  readonly call: ToolCall
}

export interface Interface {
  readonly materialize: (permissions?: PermissionV2.Ruleset) => Effect.Effect<Materialization>
  /** Internal registration capability exposed publicly only through Tools.Service. */
  readonly register: (tools: Readonly<Record<string, AnyTool>>) => Effect.Effect<void, RegistrationError, Scope.Scope>
  readonly activatePaths: (paths: ReadonlyArray<string>) => Effect.Effect<boolean>
  readonly recordTouchedPaths: (paths: ReadonlyArray<string>) => Effect.Effect<void>
}

export interface Materialization {
  readonly definitions: ReadonlyArray<ToolDefinition>
  readonly settle: (input: ExecuteInput) => Effect.Effect<Settlement, ToolOutputStore.Error>
}

export interface Settlement {
  readonly result: ToolResultValue
  readonly output?: ToolOutput
  readonly outputPaths?: ReadonlyArray<string>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/ToolRegistry") {}

const GET_TOOL_SCHEMA = "get_tool_schema"

const registryLayer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const applications = yield* ApplicationTools.Service
    const resources = yield* ToolOutputStore.Service
    type Registration = { readonly identity: object; readonly tool: AnyTool }
    const local = new Map<string, Array<{ readonly token: object; readonly registration: Registration }>>()
    const activatedToolsRef = yield* Ref.make(new Set<string>())
    const touchedPathsRef = yield* Ref.make(new Set<string>())

    const settleWith = Effect.fn("ToolRegistry.settle")(function* (input: ExecuteInput, advertised?: object) {
      const registration =
        local.get(input.call.name)?.at(-1)?.registration ?? applications.entries().get(input.call.name)
      if (!registration)
        return {
          result: {
            type: "error" as const,
            value: advertised ? `Stale tool call: ${input.call.name}` : `Unknown tool: ${input.call.name}`,
          },
        }
      if (advertised && registration.identity !== advertised)
        return { result: { type: "error" as const, value: `Stale tool call: ${input.call.name}` } }
      const pending = yield* settle(registration.tool, input.call, {
        sessionID: input.sessionID,
        agent: input.agent,
        assistantMessageID: input.assistantMessageID,
        toolCallID: input.call.id,
      }).pipe(
        Effect.map((output) => ({ output })),
        Effect.catchTag("LLM.ToolFailure", (failure) =>
          Effect.succeed({ result: { type: "error" as const, value: failure.message } }),
        ),
      )
      if ("result" in pending) return pending
      const output = pending.output
      const bounded = yield* resources.bound({ sessionID: input.sessionID, toolCallID: input.call.id, output }).pipe(
        Effect.catchTag("ToolOutputStore.StorageError", (cause) =>
          Effect.logWarning("tool output bounding failed; recording unbounded output without a path", {
            operation: cause.operation,
          }).pipe(Effect.as({ output, outputPaths: [] as ReadonlyArray<string> })),
        ),
      )
      const result = ToolOutput.toResultValue(bounded.output)
      if (result.type === "error")
        return bounded.outputPaths.length > 0 ? { result, outputPaths: bounded.outputPaths } : { result }
      return bounded.outputPaths.length > 0
        ? { result, output: bounded.output, outputPaths: bounded.outputPaths }
        : { result, output: bounded.output }
    })

    const checkActivation = (name: string, tool: AnyTool, touched: Set<string>) => {
      const filter = pathFilterOf(tool)
      if (!filter) return false
      for (const path of touched) {
        if (Wildcard.match(path, filter)) return true
      }
      return false
    }

    return Service.of({
      register: Effect.fn("ToolRegistry.register")(function* (tools) {
        const entries = Object.entries(tools)
        if (entries.length === 0) return
        yield* Effect.forEach(entries, ([name]) => validateName(name), { discard: true })
        yield* Effect.uninterruptible(
          Effect.gen(function* () {
            const token = {}
            for (const [name, tool] of entries)
              local.set(name, [...(local.get(name) ?? []), { token, registration: { identity: {}, tool } }])
            yield* Effect.addFinalizer(() =>
              Effect.sync(() => {
                for (const [name] of entries) {
                  const registrations = local.get(name)?.filter((registration) => registration.token !== token) ?? []
                  if (registrations.length > 0) local.set(name, registrations)
                  else local.delete(name)
                }
              }),
            )
          }),
        )
      }),
      recordTouchedPaths: Effect.fn("ToolRegistry.recordTouchedPaths")(function* (paths) {
        yield* Ref.update(touchedPathsRef, (current) => {
          const next = new Set(current)
          for (const path of paths) next.add(path)
          return next
        })
      }),
      activatePaths: Effect.fn("ToolRegistry.activatePaths")(function* (paths) {
        const touched = yield* Ref.get(touchedPathsRef)
        for (const path of paths) touched.add(path)
        yield* Ref.set(touchedPathsRef, touched)
        const activated = yield* Ref.get(activatedToolsRef)
        let changed = false
        for (const [name, entries] of local) {
          const registration = entries.at(-1)?.registration
          if (!registration) continue
          if (activated.has(name)) continue
          if (checkActivation(name, registration.tool, touched)) {
            activated.add(name)
            changed = true
          }
        }
        for (const [name, entry] of applications.entries()) {
          if (activated.has(name)) continue
          if (checkActivation(name, entry.tool, touched)) {
            activated.add(name)
            changed = true
          }
        }
        return changed
      }),
      materialize: Effect.fn("ToolRegistry.materialize")(function* (permissions = []) {
        const registrations = new Map(applications.entries())
        for (const [name, entries] of local) {
          const registration = entries.at(-1)?.registration
          if (registration) registrations.set(name, registration)
        }
        for (const [name, registration] of registrations)
          if (whollyDisabled(permission(registration.tool, name), permissions)) registrations.delete(name)
        const activated = yield* Ref.get(activatedToolsRef)
        const touched = yield* Ref.get(touchedPathsRef)
        const defs: Array<ToolDefinition> = []
        for (const [name, registration] of registrations) {
          const tool = registration.tool
          const deferred = isDeferred(tool)
          const filter = pathFilterOf(tool)
          if (filter && !activated.has(name)) {
            let shouldActivate = false
            for (const path of touched) {
              if (Wildcard.match(path, filter)) {
                shouldActivate = true
                break
              }
            }
            if (!shouldActivate) continue
          }
          if (deferred && !activated.has(name)) {
            const fullDef = definition(name, tool)
            defs.push(
              new ToolDefinition({
                name: fullDef.name,
                description: `${fullDef.description} [Use "get_tool_schema:${fullDef.name}" to see full parameters]`,
                inputSchema: {},
              }),
            )
            continue
          }
          defs.push(definition(name, tool))
        }
        defs.push(
          new ToolDefinition({
            name: GET_TOOL_SCHEMA,
            description:
              'Get the full schema (including input/output parameters) for a deferred tool. Input: { "tool_name": "<name>" }',
            inputSchema: {
              type: "object",
              properties: {
                tool_name: { type: "string", description: "Name of the tool to get the full schema for" },
              },
              required: ["tool_name"],
            },
          }),
        )
        return {
          definitions: defs,
          settle: (input) => {
            if (input.call.name === GET_TOOL_SCHEMA) {
              const toolName = (input.call.input as Record<string, unknown>)["tool_name"]
              if (typeof toolName !== "string")
                return Effect.succeed({ result: { type: "error", value: "Invalid input: tool_name must be a string" } })
              const registration = registrations.get(toolName)
              if (!registration)
                return Effect.succeed({ result: { type: "error", value: `Unknown tool: ${toolName}` } })
              const schema = fullSchemaRecord(toolName, registration.tool)
              return Effect.succeed({
                result: { type: "json", value: schema },
              })
            }
            const registration = registrations.get(input.call.name)
            if (registration) return settleWith(input, registration.identity)
            return Effect.succeed({ result: { type: "error", value: `Unknown tool: ${input.call.name}` } })
          },
        }
      }),
    })
  }),
)

const layer = Layer.effect(
  Tools.Service,
  Service.use((registry) => Effect.succeed(Tools.Service.of({ register: registry.register }))),
).pipe(Layer.provideMerge(registryLayer))

function whollyDisabled(action: string, rules: PermissionV2.Ruleset) {
  const rule = rules.findLast((rule) => Wildcard.match(action, rule.action))
  return rule?.resource === "*" && rule.effect === "deny"
}

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [ApplicationTools.node, ToolOutputStore.node],
})

export const toolsNode = makeLocationNode({
  service: Tools.Service,
  layer,
  deps: [ApplicationTools.node, ToolOutputStore.node],
})
