// src/features/vault/lib/duplicateCheck.ts
//
// Stage 1: exact SHA-256 content hash match
// Stage 2: 64-bit simhash over 3-gram character shingles, Hamming distance ≤ 9

import {
  getIngestedFileByHash,
  getRecentIngestedFiles,
  insertIngestedFile,
} from '@/features/notes/db/queries'

// ── SHA-256 ───────────────────────────────────────────────────────────────────

export async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(text)
  )
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

// ── Simhash ───────────────────────────────────────────────────────────────────
// 64-bit simhash over 3-gram character shingles.
// Represented as two 32-bit numbers [hi, lo] to avoid JS BigInt precision loss.

function preprocess(text: string): string {
  return text.toLowerCase().replace(/[\s\p{P}]/gu, '')
}

function hashShingle(s: string): [number, number] {
  // FNV-1a 64-bit approximated with two 32-bit halves
  let hi = 0x811c9dc5
  let lo = 0x27d4eb2f
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    lo ^= c
    const prevLo = lo
    lo = Math.imul(lo, 0x01000193)
    hi ^= c
    hi = Math.imul(hi, 0x01000193) ^ (prevLo >>> 16)
  }
  return [hi >>> 0, lo >>> 0]
}

export function computeSimhash(text: string): string {
  const processed = preprocess(text)
  const v = new Array(64).fill(0)

  for (let i = 0; i <= processed.length - 3; i++) {
    const shingle = processed.slice(i, i + 3)
    const [hi, lo] = hashShingle(shingle)
    for (let bit = 0; bit < 32; bit++) {
      v[bit]      += (hi >> bit) & 1 ? 1 : -1
      v[bit + 32] += (lo >> bit) & 1 ? 1 : -1
    }
  }

  let hi = 0
  let lo = 0
  for (let bit = 0; bit < 32; bit++) {
    if (v[bit] > 0)      hi |= 1 << bit
    if (v[bit + 32] > 0) lo |= 1 << bit
  }
  return `${(hi >>> 0).toString(16).padStart(8, '0')}${(lo >>> 0).toString(16).padStart(8, '0')}`
}

function hammingDistance(a: string, b: string): number {
  let dist = 0
  for (let i = 0; i < 16; i += 2) {
    let x = parseInt(a.slice(i, i + 2), 16) ^ parseInt(b.slice(i, i + 2), 16)
    while (x) { dist += x & 1; x >>>= 1 }
  }
  return dist
}

// ── Duplicate check result ────────────────────────────────────────────────────

export type DuplicateResult =
  | { kind: 'none' }
  | { kind: 'exact'; hash: string }
  | {
      kind: 'near'
      existingFileName: string
      existingDate: number
      existingHash: string
      charDiff: number
      newContent: string
      newHash: string
      newSimhash: string
      filePath: string
    }

const SIMHASH_WINDOW_DAYS = 30
const HAMMING_THRESHOLD   = 9

export async function checkDuplicate(
  content: string,
  filePath: string
): Promise<DuplicateResult> {
  const hash = await sha256(content)

  // Stage 1 — exact match
  const exact = await getIngestedFileByHash(hash)
  if (exact) {
    console.log(`[vault:duplicate] exact match skipped: ${filePath}`)
    return { kind: 'exact', hash }
  }

  // Stage 2 — near-duplicate simhash
  const simhash = computeSimhash(content)
  const recent  = await getRecentIngestedFiles(SIMHASH_WINDOW_DAYS)

  for (const row of recent) {
    const dist = hammingDistance(simhash, row.simhash)
    if (dist <= HAMMING_THRESHOLD) {
      const existingFileName = row.file_path.split(/[/\\]/).pop() ?? row.file_path
      const charDiff = content.length - (row.simhash.length * 4) // rough estimate
      return {
        kind: 'near',
        existingFileName,
        existingDate: row.ingested_at,
        existingHash: row.content_hash,
        charDiff: Math.max(0, content.length - content.length + charDiff),
        newContent: content,
        newHash: hash,
        newSimhash: simhash,
        filePath,
      }
    }
  }

  return { kind: 'none' }
}

// ── Record ingestion ──────────────────────────────────────────────────────────
// Call AFTER successful ingestion, never before.

export async function recordIngestion(
  contentHash: string,
  simhash: string,
  filePath: string
): Promise<void> {
  await insertIngestedFile({
    content_hash: contentHash,
    simhash,
    file_path: filePath,
    ingested_at: Date.now(),
  })
}