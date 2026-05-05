// src/features/vault/lib/pipeline.ts
//
// Vault ingestion pipeline — entry point for all vault:file-detected events.
// Milestone 1.3: duplicate check only. Normaliser and beyond in later milestones.

import { invoke } from '@tauri-apps/api/core'
import { checkDuplicate, recordIngestion } from './duplicateCheck'
import type { VaultFileDetectedEvent } from './watchedFolderService'

export type DuplicatePromptPayload = {
  existingFileName: string
  existingDate: number
  existingHash: string
  charDiff: number
  newContent: string
  newHash: string
  newSimhash: string
  filePath: string
}

type PromptHandler = (payload: DuplicatePromptPayload) => void

let _onDuplicatePrompt: PromptHandler | null = null

export function registerDuplicatePromptHandler(handler: PromptHandler): void {
  _onDuplicatePrompt = handler
}

// ── Main pipeline entry ───────────────────────────────────────────────────────

export async function handleFileDetected(
  event: VaultFileDetectedEvent
): Promise<void> {
  const { path } = event

  // Read file content via existing Rust command
  let content: string
  try {
    content = await invoke<string>('read_file', { path })
  } catch (err) {
    console.error(`[vault:pipeline] failed to read file: ${path}`, err)
    return
  }

  // Deduplicate rapid multi-event bursts from Windows — wait briefly then check
  // if this path is already being processed. Simple path-based in-flight guard.
  if (inFlight.has(path)) {
    console.log(`[vault:pipeline] in-flight skip: ${path}`)
    return
  }
  inFlight.add(path)

  try {
    const result = await checkDuplicate(content, path)

    if (result.kind === 'exact') {
      // Already logged in checkDuplicate
      return
    }

    if (result.kind === 'near') {
      // Surface the prompt — pipeline pauses here until user responds
      _onDuplicatePrompt?.({
        existingFileName: result.existingFileName,
        existingDate:     result.existingDate,
        existingHash:     result.existingHash,
        charDiff:         result.charDiff,
        newContent:       result.newContent,
        newHash:          result.newHash,
        newSimhash:       result.newSimhash,
        filePath:         path,
      })
      return
      // Resolution (import/replace/skip) is handled by onDuplicateAction below
    }

    // No duplicate — proceed to normaliser (Milestone 1.4)
    // For now: log and record ingestion stub
    console.log(`[vault:pipeline] no duplicate, proceeding: ${path}`)
    await proceedWithIngestion(content, result.kind === 'none' ? await import('./duplicateCheck').then(m => m.sha256(content)) : '', path)

  } finally {
    // Clear in-flight after a short delay to catch burst events for same file
    setTimeout(() => inFlight.delete(path), 2000)
  }
}

// ── Duplicate resolution ──────────────────────────────────────────────────────

export async function onDuplicateAction(
  action: 'import' | 'replace' | 'skip',
  payload: DuplicatePromptPayload
): Promise<void> {
  const { newContent, newHash, newSimhash, existingHash, filePath } = payload

  if (action === 'skip') {
    // Insert into ingested_files so future imports are silently skipped
    await recordIngestion(newHash, newSimhash, filePath)
    console.log(`[vault:pipeline] user skipped: ${filePath}`)
    return
  }

  if (action === 'replace') {
    // Delete old ingested_files entry so it won't conflict
    const { deleteIngestedFileByHash } = await import('@/features/notes/db/queries')
    await deleteIngestedFileByHash(existingHash)
    // TODO Milestone 3: also delete old vault entry + note
    console.log(`[vault:pipeline] replace selected — old entry cleared: ${filePath}`)
  }

  // Both 'import' and 'replace' proceed to ingestion
  await proceedWithIngestion(newContent, newHash, filePath)
}

// ── Ingestion (stub — expanded in Milestones 1.4, 2.x, 3.x) ─────────────────

async function proceedWithIngestion(
  content: string,
  hash: string,
  filePath: string
): Promise<void> {
  // Milestone 1.3: record ingestion only. Normaliser in 1.4.
  const { computeSimhash } = await import('./duplicateCheck')
  const simhash = computeSimhash(content)
  const finalHash = hash || await (await import('./duplicateCheck')).sha256(content)
  await recordIngestion(finalHash, simhash, filePath)
  console.log(`[vault:pipeline] ingestion recorded: ${filePath}`)
  // Milestone 1.4 will call the normaliser here
}

// ── In-flight guard ───────────────────────────────────────────────────────────
// Windows fires 3 events per file drop. This prevents triple-processing.

const inFlight = new Set<string>()