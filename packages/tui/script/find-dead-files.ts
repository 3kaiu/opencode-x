// One-off audit: list src files never imported by any other file in this package.
// Run: bun script/find-dead-files.ts
import { Glob } from "bun"
import path from "node:path"

const root = path.resolve(import.meta.dir, "..")
const files: string[] = []
for await (const file of new Glob("{src,test,script}/**/*.{ts,tsx}").scan(root)) {
  files.push(file)
}

const contents = new Map<string, string>()
for (const file of files) {
  contents.set(file, await Bun.file(path.join(root, file)).text())
}

// Entry points and files referenced by convention rather than import.
const entryPatterns = [/^src\/index\.tsx?$/, /^src\/cli\//, /\.test\.tsx?$/, /\.d\.ts$/, /^script\//, /^test\//]

const dead = files
  .filter((file) => file.startsWith("src/"))
  .filter((file) => !entryPatterns.some((p) => p.test(file)))
  .filter((file) => {
    const noExt = file.replace(/\.(tsx|ts)$/, "")
    const base = path.basename(noExt)
    const isIndex = base === "index"
    const dir = path.dirname(noExt)
    return !files.some((other) => {
      if (other === file) return false
      const text = contents.get(other)!
      const otherDir = path.dirname(other)
      // Candidate specifiers that would resolve to this file.
      const relFromOther = path.relative(otherDir, noExt).replace(/\\/g, "/")
      const specs = [
        relFromOther.startsWith(".") ? relFromOther : `./${relFromOther}`,
        // index files are importable via their directory
        ...(isIndex
          ? [path.relative(otherDir, dir).replace(/\\/g, "/")].map((s) => (s.startsWith(".") ? s : `./${s}`))
          : []),
      ]
      return specs.some(
        (spec) =>
          text.includes(`"${spec}"`) ||
          text.includes(`'${spec}'`) ||
          text.includes(`"${spec}.ts"`) ||
          text.includes(`"${spec}.tsx"`) ||
          text.includes(`'${spec}.ts'`) ||
          text.includes(`'${spec}.tsx'`),
      )
    })
  })

console.log(dead.join("\n"))
console.log(`\n${dead.length} candidate dead files`)
