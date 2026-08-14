import { expect, test } from "bun:test"
import { Schema } from "effect"
import { Agent } from "@opencode-ai/schema/agent"
import { Location } from "@opencode-ai/schema/location"
import { Model } from "@opencode-ai/schema/model"
import { AgentAttachment, FileAttachment, Prompt, Source } from "@opencode-ai/schema/prompt"
import { Provider } from "@opencode-ai/schema/provider"
import { Project } from "@opencode-ai/schema/project"
import { ProjectDirectories } from "@opencode-ai/schema/project-directories"
import { PermissionV1 } from "@opencode-ai/schema/permission-v1"
import { Session } from "@opencode-ai/schema/session"
import { SessionInput } from "@opencode-ai/schema/session-input"
import { SessionMessage } from "@opencode-ai/schema/session-message"
import { Workspace } from "@opencode-ai/schema/workspace"
import { Command } from "@opencode-ai/schema/command"
import { Connection } from "@opencode-ai/schema/connection"
import { Credential } from "@opencode-ai/schema/credential"
import { FileSystem } from "@opencode-ai/schema/filesystem"
import { Integration } from "@opencode-ai/schema/integration"
import { LLM } from "@opencode-ai/schema/llm"
import { Permission } from "@opencode-ai/schema/permission"
import { Plugin } from "@opencode-ai/schema/plugin"
import { Pty } from "@opencode-ai/schema/pty"
import { Reference } from "@opencode-ai/schema/reference"
import { SessionTodo } from "@opencode-ai/schema/session-todo"
import { Skill } from "@opencode-ai/schema/skill"
import { AbsolutePath, DateTimeUtcFromMillis, optional, statics } from "@opencode-ai/schema/schema"

test("Core reuses the canonical shared schemas", async () => {
  const [
    coreAgent,
    coreCommand,
    coreConnection,
    coreCredential,
    coreFileSystem,
    coreIntegration,
    coreLocation,
    coreLLM,
    coreModel,
    corePermission,
    corePermissionV1,
    coreProjectCopy,
    corePty,
    coreProject,
    coreProvider,
    coreReference,
    coreSession,
    coreSessionInput,
    coreSessionMessage,
    coreSessionTodo,
    corePrompt,
    coreSkill,
    coreSchema,
    coreWorkspace,
    corePlugin,
  ] = await Promise.all([
    import("@opencode-ai/core/agent"),
    import("@opencode-ai/core/command"),
    import("@opencode-ai/core/integration/connection"),
    import("@opencode-ai/core/credential"),
    import("@opencode-ai/core/filesystem"),
    import("@opencode-ai/core/integration"),
    import("@opencode-ai/core/location"),
    import("@opencode-ai/llm"),
    import("@opencode-ai/core/model"),
    import("@opencode-ai/core/permission"),
    import("@opencode-ai/core/v1/permission"),
    import("@opencode-ai/core/project/copy"),
    import("@opencode-ai/core/pty"),
    import("@opencode-ai/core/project/schema"),
    import("@opencode-ai/core/provider"),
    import("@opencode-ai/core/reference"),
    import("@opencode-ai/core/session"),
    import("@opencode-ai/core/session/input"),
    import("@opencode-ai/core/session/message"),
    import("@opencode-ai/core/session/todo"),
    import("@opencode-ai/core/session/prompt"),
    import("@opencode-ai/core/skill"),
    import("@opencode-ai/core/schema"),
    import("@opencode-ai/core/workspace"),
    import("@opencode-ai/core/plugin"),
  ])

  const schemas = [
    [coreAgent.ID, Agent.ID],
    [coreAgent.Color, Agent.Color],
    [coreAgent.Info, Agent.Info],
    [coreCommand.Info, Command.Info],
    [coreConnection.CredentialInfo, Connection.CredentialInfo],
    [coreConnection.EnvInfo, Connection.EnvInfo],
    [coreConnection.Info, Connection.Info],
    [coreCredential.ID, Credential.ID],
    [coreCredential.OAuth, Credential.OAuth],
    [coreCredential.Key, Credential.Key],
    [coreCredential.Value, Credential.Value],
    [coreFileSystem.Entry, FileSystem.Entry],
    [coreFileSystem.Submatch, FileSystem.Submatch],
    [coreFileSystem.Match, FileSystem.Match],
    [coreIntegration.ID, Integration.ID],
    [coreIntegration.MethodID, Integration.MethodID],
    [coreIntegration.When, Integration.When],
    [coreIntegration.TextPrompt, Integration.TextPrompt],
    [coreIntegration.SelectPrompt, Integration.SelectPrompt],
    [coreIntegration.Prompt, Integration.Prompt],
    [coreIntegration.OAuthMethod, Integration.OAuthMethod],
    [coreIntegration.KeyMethod, Integration.KeyMethod],
    [coreIntegration.EnvMethod, Integration.EnvMethod],
    [coreIntegration.Method, Integration.Method],
    [coreIntegration.Inputs, Integration.Inputs],
    [coreIntegration.Ref, Integration.Ref],
    [coreLocation.Ref, Location.Ref],
    [coreLLM.ProviderMetadata, LLM.ProviderMetadata],
    [coreLLM.ToolTextContent, LLM.ToolTextContent],
    [coreLLM.ToolFileContent, LLM.ToolFileContent],
    [coreLLM.ToolContent, LLM.ToolContent],
    [coreModel.ID, Model.ID],
    [coreModel.VariantID, Model.VariantID],
    [coreModel.Ref, Model.Ref],
    [coreModel.Family, Model.Family],
    [coreModel.Capabilities, Model.Capabilities],
    [coreModel.Cost, Model.Cost],
    [coreModel.Api, Model.Api],
    [coreModel.Info, Model.Info],
    [coreProvider.ID, Provider.ID],
    [coreProvider.AISDK, Provider.AISDK],
    [coreProvider.Native, Provider.Native],
    [coreProvider.Api, Provider.Api],
    [coreProvider.Request, Provider.Request],
    [coreProvider.Info, Provider.Info],
    [corePermission.Effect, Permission.Effect],
    [corePermission.Rule, Permission.Rule],
    [corePermission.Ruleset, Permission.Ruleset],
    [corePermissionV1.Event, PermissionV1.Event],
    [coreProjectCopy.Event, ProjectDirectories.Event],
    [corePlugin.ID, Plugin.ID],
    [corePlugin.Event, Plugin.Event],
    [corePty.Info, Pty.Info],
    [corePty.Event, Pty.Event],
    [coreProject.ID, Project.ID],
    [coreReference.LocalSource, Reference.LocalSource],
    [coreReference.GitSource, Reference.GitSource],
    [coreReference.Source, Reference.Source],
    [coreSession.ID, Session.ID],
    [coreSession.Info, Session.Info],
    [coreSession.ListAnchor, Session.ListAnchor],
    [coreSessionInput.Delivery, SessionInput.Delivery],
    [coreSessionInput.Admitted, SessionInput.Admitted],
    [coreSessionMessage.ID, SessionMessage.ID],
    [coreSessionMessage.UnknownError, SessionMessage.UnknownError],
    [coreSessionMessage.AgentSwitched, SessionMessage.AgentSwitched],
    [coreSessionMessage.ModelSwitched, SessionMessage.ModelSwitched],
    [coreSessionMessage.User, SessionMessage.User],
    [coreSessionMessage.Synthetic, SessionMessage.Synthetic],
    [coreSessionMessage.System, SessionMessage.System],
    [coreSessionMessage.Shell, SessionMessage.Shell],
    [coreSessionMessage.ToolStatePending, SessionMessage.ToolStatePending],
    [coreSessionMessage.ToolStateRunning, SessionMessage.ToolStateRunning],
    [coreSessionMessage.ToolStateCompleted, SessionMessage.ToolStateCompleted],
    [coreSessionMessage.ToolStateError, SessionMessage.ToolStateError],
    [coreSessionMessage.ToolState, SessionMessage.ToolState],
    [coreSessionMessage.AssistantTool, SessionMessage.AssistantTool],
    [coreSessionMessage.AssistantText, SessionMessage.AssistantText],
    [coreSessionMessage.AssistantReasoning, SessionMessage.AssistantReasoning],
    [coreSessionMessage.AssistantContent, SessionMessage.AssistantContent],
    [coreSessionMessage.Assistant, SessionMessage.Assistant],
    [coreSessionMessage.Compaction, SessionMessage.Compaction],
    [coreSessionMessage.Message, SessionMessage.Message],
    [coreSessionTodo.Info, SessionTodo.Info],
    [coreSessionTodo.Event, SessionTodo.Event],
    [corePrompt.Source, Source],
    [corePrompt.FileAttachment, FileAttachment],
    [corePrompt.AgentAttachment, AgentAttachment],
    [corePrompt.Prompt, Prompt],
    [coreSkill.DirectorySource, Skill.DirectorySource],
    [coreSkill.UrlSource, Skill.UrlSource],
    [coreSkill.EmbeddedSource, Skill.EmbeddedSource],
    [coreSkill.Source, Skill.Source],
    [coreSkill.Info, Skill.Info],
    [coreSchema.DateTimeUtcFromMillis, DateTimeUtcFromMillis],
    [coreSchema.optional, optional],
    [coreSchema.statics, statics],
    [coreWorkspace.ID, Workspace.ID],
  ]
  for (const [core, shared] of schemas) expect(core).toBe(shared)

  expect(Agent.Info.empty(Agent.ID.make("test"))).toEqual(Agent.Info.empty(Agent.ID.make("test")))
  expect(Model.Info.empty(Provider.ID.make("test"), Model.ID.make("model"))).toEqual(
    Model.Info.empty(Provider.ID.make("test"), Model.ID.make("model")),
  )
  expect(Provider.Info.empty(Provider.ID.make("test"))).toEqual(Provider.Info.empty(Provider.ID.make("test")))
  expect(Skill.Source.key(Skill.DirectorySource.make({ type: "directory", path: AbsolutePath.make("/tmp") }))).toBe(
    "directory:/tmp",
  )
})

test("shared record schemas construct and decode plain objects", () => {
  const made = Prompt.make({ text: "hello" })
  const decoded = Schema.decodeUnknownSync(Prompt)({ text: "hello" })
  const content = Schema.decodeUnknownSync(SessionMessage.AssistantText)({ type: "text", id: "part_1", text: "hi" })

  expect(Object.getPrototypeOf(made)).toBe(Object.prototype)
  expect(Object.getPrototypeOf(decoded)).toBe(Object.prototype)
  expect(Object.getPrototypeOf(content)).toBe(Object.prototype)
  expect(Prompt.ast.annotations?.identifier).toBe("Prompt")
  expect(SessionMessage.AssistantText.ast.annotations?.identifier).toBe("Session.Message.Assistant.Text")
  expect(Prompt.equivalence(Prompt.make({ text: "hello" }), decoded)).toBe(true)
  expect(Prompt.fromUserMessage({ text: "hello" })).toEqual(made)
  expect(Workspace.ID.ascending("")).toStartWith("wrk_")
})
