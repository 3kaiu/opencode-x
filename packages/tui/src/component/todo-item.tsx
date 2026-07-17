import { createMemo } from "solid-js"
import { useTheme } from "../context/theme"
import { AnimatedIcon, TodoIcon } from "../ui/icon"

export interface TodoItemProps {
  status: string
  content: string
}

export function TodoItem(props: TodoItemProps) {
  const { theme } = useTheme()

  const color = createMemo(() => (props.status === "in_progress" ? theme.warning : theme.textMuted))
  const icon = createMemo(() => TodoIcon[props.status] ?? "idle")

  return (
    <box flexDirection="row" gap={1}>
      <AnimatedIcon icon={icon()} fg={color()} />
      <text
        flexGrow={1}
        wrapMode="word"
        style={{
          fg: color(),
        }}
      >
        {props.content}
      </text>
    </box>
  )
}
