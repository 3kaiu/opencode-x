import { createMemo } from "solid-js"
import { useProject } from "./project"
import { useData } from "./data"
import { abbreviateHome } from "../runtime"
import { useTuiPaths } from "./runtime"

export function useDirectory() {
  const project = useProject()
  const sync = useData()
  const paths = useTuiPaths()
  return createMemo(() => {
    const directory = project.instance.path().directory || paths.cwd
    const result = abbreviateHome(directory, paths.home)
    if (sync.instance.vcs?.branch) return result + ":" + sync.instance.vcs.branch
    return result
  })
}
