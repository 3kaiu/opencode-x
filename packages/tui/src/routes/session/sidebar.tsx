import { useProject } from "../../context/project"
import { useSync } from "../../context/sync"
import { createMemo, Show } from "solid-js"
import { useTheme } from "../../context/theme"
import { useTuiConfig } from "../../config"
import { InstallationChannel, InstallationVersion } from "@opencode-ai/core/installation/version"
import { usePluginRuntime } from "../../plugin/runtime"
import { useLocal } from "../../context/local"
import { useTerminalDimensions } from "@opentui/solid"
import * as Model from "../../util/model"

import { getScrollAcceleration } from "../../util/scroll"
import { WorkspaceLabel } from "../../component/workspace-label"

export function Sidebar(props: { sessionID: string; overlay?: boolean }) {
  const pluginRuntime = usePluginRuntime()
  const project = useProject()
  const sync = useSync()
  const { theme } = useTheme()
  const tuiConfig = useTuiConfig()
  const local = useLocal()
  const dimensions = useTerminalDimensions()
  const session = createMemo(() => sync.session.get(props.sessionID))
  const status = createMemo(() => sync.data.session_status[props.sessionID])
  const workspace = () => {
    const workspaceID = session()?.workspaceID
    if (!workspaceID) return
    return project.workspace.get(workspaceID)
  }
  const scrollAcceleration = createMemo(() => getScrollAcceleration(tuiConfig))
  const sidebarWidth = createMemo(() => {
    const w = dimensions().width
    if (w > 160) return 48
    if (w > 120) return 42
    return 36
  })
  const agentName = createMemo(() => local.agent.current()?.name)
  const agentColor = createMemo(() => local.agent.color(agentName() ?? ""))
  const modelName = createMemo(() => {
    const m = local.model.current()
    if (!m) return undefined
    return Model.name(sync.data.provider, m.providerID, m.modelID)
  })
  const statusInfo = createMemo(() => {
    const s = status()
    if (!s) return { icon: "•", color: theme.textMuted, label: "idle" }
    if (s.type === "busy") return { icon: "◔", color: theme.warning, label: "busy" }
    if (s.type === "retry") return { icon: "⊙", color: theme.error, label: "retry" }
    return { icon: "•", color: theme.success, label: "idle" }
  })

  return (
    <Show when={session()}>
      <box
        backgroundColor={theme.backgroundPanel}
        width={sidebarWidth()}
        height="100%"
        paddingTop={1}
        paddingBottom={1}
        paddingLeft={2}
        paddingRight={2}
        position={props.overlay ? "absolute" : "relative"}
      >
        <scrollbox
          flexGrow={1}
          scrollAcceleration={scrollAcceleration()}
          verticalScrollbarOptions={{
            trackOptions: {
              backgroundColor: theme.background,
              foregroundColor: theme.borderActive,
            },
          }}
        >
          <box flexShrink={0} gap={1} paddingRight={1}>
            <pluginRuntime.Slot
              name="sidebar_title"
              mode="single_winner"
              session_id={props.sessionID}
              title={session()!.title}
            >
              <box paddingRight={1}>
                <box flexDirection="row" gap={1}>
                  <text fg={statusInfo().color}>{statusInfo().icon}</text>
                  <text fg={theme.text}>
                    <b>{session()!.title}</b>
                  </text>
                </box>
                <Show when={InstallationChannel !== "latest"}>
                  <text fg={theme.textMuted}>{props.sessionID}</text>
                </Show>
                <Show when={session()!.workspaceID}>
                  <text fg={theme.textMuted}>
                    <Show
                      when={workspace()}
                      fallback={<WorkspaceLabel type="unknown" name={session()!.workspaceID!} status="error" icon />}
                    >
                      {(item) => (
                        <WorkspaceLabel
                          type={item().type}
                          name={item().name}
                          status={project.workspace.status(item().id) ?? "error"}
                          icon
                        />
                      )}
                    </Show>
                  </text>
                </Show>
                <Show when={agentName()}>
                  <text fg={theme.textMuted}>
                    <span style={{ fg: agentColor() }}>▣</span> {agentName()}
                  </text>
                </Show>
                <Show when={modelName()}>
                  <text fg={theme.textMuted}>⌬ {modelName()}</text>
                </Show>
                <Show when={session()!.share?.url}>
                  <text fg={theme.textMuted}>{session()!.share!.url}</text>
                </Show>
              </box>
            </pluginRuntime.Slot>
            <pluginRuntime.Slot name="sidebar_content" session_id={props.sessionID} />
          </box>
        </scrollbox>

        <box flexShrink={0} gap={1} paddingTop={1}>
          <pluginRuntime.Slot name="sidebar_footer" mode="single_winner" session_id={props.sessionID}>
            <text fg={theme.textMuted}>
              <span style={{ fg: theme.success }}>●</span> <b>Open</b>
              <span style={{ fg: theme.text }}>
                <b>Code</b>
              </span>{" "}
              <span>{InstallationVersion}</span>
            </text>
          </pluginRuntime.Slot>
        </box>
      </box>
    </Show>
  )
}
