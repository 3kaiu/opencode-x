import type { CommandModule } from "yargs"

export function lazyCommand<T = {}>(
  moduleObj: CommandModule<{}, T>,
  loader: () => Promise<any>,
  exportName?: string,
): CommandModule<{}, T> {
  return {
    command: moduleObj.command,
    aliases: moduleObj.aliases,
    describe: moduleObj.describe,
    builder: moduleObj.builder as any,
    async handler(args) {
      const mod = await loader()
      const target = exportName ? mod[exportName] : (mod.default || Object.values(mod)[0])
      return target.handler(args)
    },
  }
}
