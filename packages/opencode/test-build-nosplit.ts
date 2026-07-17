import { $ } from "bun"
import path from "path"
import { fileURLToPath } from "url"
import { createSolidTransformPlugin } from "@opentui/solid/bun-plugin"
import { Script } from "@opencode-ai/script"

const plugin = createSolidTransformPlugin()
const dir = process.cwd()
const parserWorkerLocal = path.resolve(dir, "node_modules/@opentui/core/parser.worker.js")
const parserWorkerRoot = path.resolve(dir, "../../node_modules/@opentui/core/parser.worker.js")
import fs from "fs"
const parserWorker = fs.realpathSync(fs.existsSync(parserWorkerLocal) ? parserWorkerLocal : parserWorkerRoot)
const workerPath = "./src/cli/tui/worker.ts"

await Bun.build({
  conditions: ["bun", "node"],
  tsconfig: "./tsconfig.json",
  plugins: [plugin],
  external: ["node-gyp"],
  format: "esm",
  minify: false,
  sourcemap: "none",
  splitting: false,
  compile: {
    autoloadBunfig: false,
    autoloadDotenv: false,
    autoloadTsconfig: true,
    autoloadPackageJson: true,
    target: "bun-darwin-arm64" as any,
    outfile: `/tmp/opencodex-nosplit`,
    execArgv: [`--user-agent=opencode/${Script.version}`, "--use-system-ca", "--"],
    windows: {},
  },
  entrypoints: ["./src/index.ts", parserWorker, workerPath],
  define: {
    FFF_LIBC: JSON.stringify("gnu"),
    OPENCODE_VERSION: `'${Script.version}'`,
    OPENCODE_MODELS_DEV: "''",
    OTUI_TREE_SITTER_WORKER_PATH: "/$bunfs/root/" + path.relative(dir, parserWorker).replaceAll("\\", "/"),
    OPENCODE_WORKER_PATH: workerPath,
    OPENCODE_CHANNEL: `'${Script.channel}'`,
    OPENCODE_LIBC: "",
  },
})
console.log("done")
