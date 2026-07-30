import { TextAttributes } from "@opentui/core"
import { useTheme } from "../context/theme"
import { GLYPH } from "../ui/glyphs"

export interface TodoItemProps {
  status: string
  content: string
}

export function TodoItem(props: TodoItemProps) {
  const { theme } = useTheme()

  const icon = () => (props.status === "completed" ? GLYPH.todo.completed : GLYPH.todo.pending)
  const color = () =>
    props.status === "completed"
      ? theme.textMuted
      : props.status === "in_progress"
        ? theme.primary
        : theme.text
  const attrs = () =>
    props.status === "completed"
      ? TextAttributes.STRIKETHROUGH
      : props.status === "in_progress"
        ? TextAttributes.BOLD
        : undefined

  return (
    <box flexDirection="row" gap={1} alignItems="center">
      <text fg={color()} attributes={attrs()}>
        {icon()}
      </text>
      <text fg={color()} attributes={attrs()}>
        {props.content}
      </text>
    </box>
  )
}
