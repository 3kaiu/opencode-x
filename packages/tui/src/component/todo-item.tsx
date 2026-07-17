import { useTheme } from "../context/theme"
import { PixelIcon } from "./icon-renderable"
import type { IconName } from "../util/icon-pixel-data"

const TodoIcon: Record<string, IconName> = {
  completed: "success",
  in_progress: "busy",
  pending: "idle",
}

export interface TodoItemProps {
  status: string
  content: string
}

export function TodoItem(props: TodoItemProps) {
  const { theme } = useTheme()

  const color = props.status === "in_progress" ? theme.warning : theme.textMuted
  const icon = TodoIcon[props.status] ?? "idle"

  return (
    <box flexDirection="row" gap={1} alignItems="center">
      <PixelIcon icon={icon} fg={color} />
      <text
        flexGrow={1}
        wrapMode="word"
        style={{
          fg: color,
        }}
      >
        {props.content}
      </text>
    </box>
  )
}
