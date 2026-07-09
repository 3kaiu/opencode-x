import { useTheme } from "../context/theme"

export interface TodoItemProps {
  status: string
  content: string
}

export function TodoItem(props: TodoItemProps) {
  const { theme } = useTheme()

  const fg = () => {
    if (props.status === "completed") return theme.success
    if (props.status === "in_progress") return theme.warning
    return theme.textMuted
  }

  const marker = () => {
    if (props.status === "completed") return "✓"
    if (props.status === "in_progress") return "•"
    return " "
  }

  return (
    <box flexDirection="row" gap={0}>
      <text flexShrink={0} fg={fg()}>
        [{marker()}]{" "}
      </text>
      <text flexGrow={1} wrapMode="word" fg={fg()}>
        {props.content}
      </text>
    </box>
  )
}
