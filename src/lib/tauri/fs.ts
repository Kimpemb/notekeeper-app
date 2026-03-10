// src/lib/tauri/fs.ts
// All Tauri invoke() calls live here only.
// Components never call invoke() directly — always go through this module.
// This keeps Phase 6 web portal migration clean: swap this file, nothing else changes.

import { invoke } from "@tauri-apps/api/core";

/**
 * Export all notes to a file chosen by the user.
 * Calls a Tauri command that opens a save dialog and writes JSON.
 */
export async function exportNotesToFile(json: string): Promise<void> {
  await invoke("export_notes", { json });
}

/**
 * Import notes from a file chosen by the user.
 * Returns the raw JSON string for parsing in the caller.
 */
export async function importNotesFromFile(): Promise<string> {
  return await invoke<string>("import_notes");
}

/**
 * Get the app data directory path (where notekeeper.db lives).
 */
export async function getAppDataDir(): Promise<string> {
  return await invoke<string>("get_app_data_dir");
}