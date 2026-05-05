// src/features/vault/lib/watchedFolderService.ts
//
// Thin TypeScript layer over the four Rust commands that manage OS-level file
// watchers. Watcher handles live in Rust (Arc<Mutex<WatcherState>>) — this
// module only issues invoke() calls and registers the single Tauri event
// listener that routes vault:file-detected events to the application layer.
//
// Startup contract:
//   Call reattachAllWatchers() once, after initDb() background work completes
//   (i.e. after _dbReadyResolve fires). Do not call initWatchedFolderService()
//   separately — reattachAllWatchers() calls it internally.
//
// Per-project folder changes (set / clear) call startWatch / stopWatch directly.

import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import Database from '@tauri-apps/plugin-sql'
// ─── Public types ─────────────────────────────────────────────────────────────

export interface VaultFileDetectedEvent {
  path: string
  watchedFolderType: 'global' | 'project'
  projectNoteId: string | null
  watchId: string
}

export type FileDetectedHandler = (event: VaultFileDetectedEvent) => void

// ─── Module-level listener state ─────────────────────────────────────────────
// Only one Tauri event listener is ever registered. Re-initialising replaces
// the previous one cleanly via unlisten().

let _unlisten: UnlistenFn | null = null
let _handler: FileDetectedHandler | null = null

// ─── initWatchedFolderService ─────────────────────────────────────────────────
// Registers the global vault:file-detected Tauri event listener.
// Called internally by reattachAllWatchers — do not call directly unless you
// have a specific reason to swap the handler without re-attaching watchers.

export async function initWatchedFolderService(
  onFileDetected: FileDetectedHandler
): Promise<void> {
  _handler = onFileDetected

  // Clean up any previous listener before registering a new one.
  if (_unlisten) {
    _unlisten()
    _unlisten = null
  }

  _unlisten = await listen<VaultFileDetectedEvent>(
    'vault:file-detected',
    (event) => {
      _handler?.(event.payload)
    }
  )
}

// ─── startWatch ───────────────────────────────────────────────────────────────
// Start watching a folder.
//
// watchId:
//   'global'            — the global inbox
//   'project:[note_id]' — a per-project watched folder
//
// Idempotent: calling with an already-active watchId is a no-op in Rust.
// Safe to call on every app start without checking existing watchers first.

export async function startWatch(
  folderPath: string,
  watchId: string,
  projectNoteId?: string
): Promise<void> {
  await invoke('start_watch', {
    folderPath,
    watchId,
    projectNoteId: projectNoteId ?? null,
  })
}

// ─── stopWatch ────────────────────────────────────────────────────────────────
// Stop watching a specific folder by watchId.
// Drops the OS-level watch handle in Rust immediately.
// Call when a user clears their watched folder setting.

export async function stopWatch(watchId: string): Promise<void> {
  await invoke('stop_watch', { watchId })
}

// ─── stopAllWatches ───────────────────────────────────────────────────────────
// Stop all active watchers. Available for app teardown if needed.
// Not called during normal operation — Rust drops handles on process exit.

export async function stopAllWatches(): Promise<void> {
  await invoke('stop_all_watches')
}

// ─── listWatches ──────────────────────────────────────────────────────────────
// Returns active watchIds — used for debugging and startup verification.

export async function listWatches(): Promise<string[]> {
  return invoke('list_watches')
}

// ─── reattachAllWatchers ──────────────────────────────────────────────────────
// Restores all active watchers from DB state on app startup.
// Must be called after initDb() background work completes (after waitForDb()).
//
// Also registers the Tauri event listener — this is the only init call needed
// on startup. Do not call initWatchedFolderService() separately.
//
// Reads:
//   app_settings.vault.global_inbox_path        — global inbox path (if set)
//   notes.vault_watched_folder WHERE NOT NULL   — per-project folder paths

export async function reattachAllWatchers(
  db: Database,
  onFileDetected: FileDetectedHandler
): Promise<void> {
  // Register the event listener first so no events are missed during reattach.
  await initWatchedFolderService(onFileDetected)

  // ── Global inbox ──────────────────────────────────────────────────────────
  try {
    const globalRows = await db.select<{ value: string }[]>(
      `SELECT value FROM app_settings WHERE key = 'vault.global_inbox_path'`
    )
    const globalPath = globalRows[0]?.value
    if (globalPath) {
      await startWatch(globalPath, 'global')
      console.log(`[vault:reattach] global inbox: ${globalPath}`)
    }
  } catch (err) {
    console.warn('[vault:reattach] failed to reattach global inbox watcher:', err)
  }

  // ── Per-project folders ───────────────────────────────────────────────────
  try {
    const projectRows = await db.select<{
      id: string
      vault_watched_folder: string
    }[]>(
      `SELECT id, vault_watched_folder
       FROM notes
       WHERE vault_watched_folder IS NOT NULL
         AND vault_watched_folder != ''
         AND deleted_at IS NULL`
    )

    for (const row of projectRows) {
      try {
        await startWatch(row.vault_watched_folder, `project:${row.id}`, row.id)
        console.log(`[vault:reattach] project ${row.id}: ${row.vault_watched_folder}`)
      } catch (err) {
        // Don't let one bad path block the rest.
        console.warn(`[vault:reattach] failed for project ${row.id}:`, err)
      }
    }
  } catch (err) {
    console.warn('[vault:reattach] failed to query per-project folders:', err)
  }

  const active = await listWatches().catch(() => [] as string[])
  console.log(`[vault:reattach] complete. Active watchers: [${active.join(', ')}]`)
}