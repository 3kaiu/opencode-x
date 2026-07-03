import { $ } from "bun"

console.log("🔨 Building token counter (Zig → WASM)...")
const result = await $`cd ${import.meta.dir}/.. && zig build`.text()
console.log(result || "✅ Done")
