import path from "path"
import { fileURLToPath } from "url"

let _countTokens: ((text: string) => number) | null = null

export async function initWasm(projectRoot?: string): Promise<void> {
  if (_countTokens) return

  const root = projectRoot ?? path.resolve(import.meta.dir, "..", "..", "..")
  const wasmPath = path.join(root, "natives/token-counter/zig-out/bin/token_counter.wasm")

  const wasm = await Bun.file(wasmPath).arrayBuffer()
  const mod = new WebAssembly.Module(wasm)
  const instance = new WebAssembly.Instance(mod, {})

  const { count_tokens: countWasm } = instance.exports as {
    count_tokens: (ptr: number, len: number) => number
    memory: WebAssembly.Memory
  }

  _countTokens = (text: string) => {
    const encoded = new TextEncoder().encode(text)
    if (encoded.length === 0) return 0

    const mem = instance.exports.memory as WebAssembly.Memory
    const ptr = 0
    const view = new Uint8Array(mem.buffer)
    view.set(encoded, ptr)

    return countWasm(ptr, encoded.length)
  }
}

export function countTokens(text: string): number {
  if (!_countTokens) throw new Error("WASM not initialized. Call initWasm() first.")
  return _countTokens(text)
}
