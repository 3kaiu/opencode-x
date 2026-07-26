import { TextAttributes } from "@opentui/core"
import { useTheme } from "../context/theme"

export interface TodoItemProps {
  status: string
  content: string
}

export function TodoItem(props: TodoItemProps) {
  const { theme } = useTheme()

  const icon = props.status === "completed" ? "✓" : props.status === "in_progress" ? "◐" : props.status === "pending" ? "○" : "•"
  const color = props.status === "completed"
    ? theme.success
    : props.status === "in_progress"
      ? theme.warning
      : props.status === "pending"
        ? theme.borderSubtle
        : theme.textMuted
  const attrs = props.status === "completed"
    ? TextAttributes.STRIKETHROUGH
    : props.status === "in_progress"
      ? TextAttributes.BOLD
      : undefined

  return (
    <box flexDirection="row" gap={1} alignItems="center">
      <text fg={color} attributes={attrs}>
        {icon}
      </text>
      <text fg={color} attributes={attrs}>
        {props.content}
      </text>
    </box>
  )
}
