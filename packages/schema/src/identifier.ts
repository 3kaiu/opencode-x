const length = 26
const chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
const charTable = Array.from({ length: 256 }, (_, index) => chars[index % 62])
let lastTimestamp = 0
let counter = 0

export function ascending() {
  return create(false)
}

export function descending() {
  return create(true)
}

export function create(descending: boolean, timestamp = Date.now()) {
  if (timestamp !== lastTimestamp) {
    lastTimestamp = timestamp
    counter = 0
  }
  counter++

  const current = BigInt(timestamp) * 0x1000n + BigInt(counter)
  const value = descending ? ~current : current
  const time = (value & 0xffffffffffffn).toString(16).padStart(12, "0")
  const bytes = crypto.getRandomValues(new Uint8Array(length - 12))
  let suffix = ""
  for (let i = 0; i < bytes.length; i++) suffix += charTable[bytes[i]]
  return time + suffix
}
