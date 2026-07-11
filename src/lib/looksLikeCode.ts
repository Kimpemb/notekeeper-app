export function looksLikeCodeBlob(text: string): boolean {
  const trimmed = text.trim()

  try {
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      JSON.parse(trimmed)
      return true
    }
  } catch { /* not valid JSON — fall through to punctuation/shape check */ }

  const lines = trimmed.split("\n").filter((l) => l.trim().length > 0)
  if (lines.length === 0) return false

  const codeLikeLines = lines.filter((line) => {
    if (/[{}[\];]|=>/.test(line)) return true
    const kv = line.match(/^\s*["']?([\w.-]+)["']?\s*[:=]\s*\S/)
    return !!kv
  }).length

  return codeLikeLines / lines.length > 0.6 && codeLikeLines >= 2
}

// Wraps raw pasted text in a markdown fence long enough that any backtick runs
// already inside the content can't terminate it early — same class of bug as
// the tauri.config.json paste-breakout fix, applied here for the overlay's
// code rendering path.
export function wrapAsCodeFence(text: string): string {
  const backtickRuns = text.match(/`+/g) ?? []
  const longestRun = backtickRuns.reduce((max, run) => Math.max(max, run.length), 0)
  const fenceLength = Math.max(3, longestRun + 1)
  const fence = "`".repeat(fenceLength)
  return `${fence}\n${text}\n${fence}`
}