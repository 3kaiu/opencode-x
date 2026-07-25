import { useTheme } from "../context/theme"

export interface TodoItemProps {
  status: string
  content: string
}

export function TodoItem(props: TodoItemProps) {
  const { theme } = useTheme()
  const color = props.status === "in_progress" ? theme.warning : theme.textMuted
  const icon = props.status === "completed" ? "✓" : props.status === "in_progress" ? "●" : "○"

  return (
    <text>
      <span style={{ fg: color }}>{icon} </span>
      <span style={{ fg: color }}>{props.content}</span>
    </text>
  )
}
