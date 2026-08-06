export function titlecase(str: string) {
  return str.replace(/\b\w/g, (c) => c.toUpperCase())
}

export function time(input: number): string {
  const date = new Date(input)
  return date.toLocaleTimeString(undefined, { timeStyle: "short" })
}

export function datetime(input: number): string {
  const date = new Date(input)
  const localTime = time(input)
  const localDate = date.toLocaleDateString()
  return `${localTime} · ${localDate}`
}

export function todayTimeOrDateTime(input: number): string {
  const date = new Date(input)
  const now = new Date()
  const isToday =
    date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate()

  if (isToday) return time(input)
  return datetime(input)
}

export function number(num: number): string {
  if (num >= 1000000) {
    return (num / 1000000).toFixed(1) + "M"
  } else if (num >= 1000) {
    return (num / 1000).toFixed(1) + "K"
  }
  return num.toString()
}

const currency = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" })

export function money(amount: number): string {
  return currency.format(amount)
}

export function duration(input: number) {
  if (input < 1000) {
    return `${input}ms`
  }
  if (input < 60000) {
    return `${(input / 1000).toFixed(1)}s`
  }
  if (input < 3600000) {
    const minutes = Math.floor(input / 60000)
    const seconds = Math.floor((input % 60000) / 1000)
    return `${minutes}m ${seconds}s`
  }
  if (input < 86400000) {
    const hours = Math.floor(input / 3600000)
    const minutes = Math.floor((input % 3600000) / 60000)
    return `${hours}h ${minutes}m`
  }
  const days = Math.floor(input / 86400000)
  const hours = Math.floor((input % 86400000) / 3600000)
  return `${days}d ${hours}h`
}

/**
 * Display width of a string in terminal cells (CJK chars count as 2). Falls
 * back to code-point count outside the Bun runtime.
 */
function displayWidth(str: string): number {
  return typeof Bun !== "undefined" ? Bun.stringWidth(str) : [...str].length
}

/** Take leading code points until their display width would exceed `width`. */
function takeWidth(str: string, width: number): string {
  let out = ""
  let used = 0
  for (const ch of str) {
    const w = displayWidth(ch)
    if (used + w > width) break
    out += ch
    used += w
  }
  return out
}

/** Take trailing code points until their display width would exceed `width`. */
function takeRightWidth(str: string, width: number): string {
  const chars = [...str]
  let out = ""
  let used = 0
  for (let i = chars.length - 1; i >= 0; i--) {
    const w = displayWidth(chars[i])
    if (used + w > width) break
    out = chars[i] + out
    used += w
  }
  return out
}

// Truncation is display-width aware so mixed CJK/Latin titles (session titles,
// file names, model names) keep their right edge aligned in the terminal.
export function truncate(str: string, len: number): string {
  if (displayWidth(str) <= len) return str
  if (len <= 1) return "…"
  return takeWidth(str, len - 1) + "…"
}

export function truncateLeft(str: string, len: number): string {
  if (displayWidth(str) <= len) return str
  if (len <= 1) return "…"
  return "…" + takeRightWidth(str, len - 1)
}

export function truncateMiddle(str: string, maxLength: number = 35): string {
  if (displayWidth(str) <= maxLength) return str

  const ellipsis = "…"
  const keep = maxLength - displayWidth(ellipsis)
  const keepStart = Math.ceil(keep / 2)
  const keepEnd = Math.floor(keep / 2)

  return takeWidth(str, keepStart) + ellipsis + takeRightWidth(str, keepEnd)
}

export function relativeTime(timestamp: number): string {
  const now = Date.now()
  const diff = now - timestamp

  if (diff < 60000) return "just now"
  if (diff < 3600000) {
    const minutes = Math.floor(diff / 60000)
    return `${minutes}m ago`
  }
  if (diff < 86400000) {
    const hours = Math.floor(diff / 3600000)
    return `${hours}h ago`
  }
  if (diff < 604800000) {
    const days = Math.floor(diff / 86400000)
    return `${days}d ago`
  }
  const weeks = Math.floor(diff / 604800000)
  return `${weeks}w ago`
}

export * as Locale from "./locale"
