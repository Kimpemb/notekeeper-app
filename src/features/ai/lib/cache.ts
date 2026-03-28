// src/features/ai/lib/cache.ts
//
// Simple in-memory cache for AI results.
// Keyed by noteId + action + note's updated_at timestamp.
// Cache auto-invalidates when the note is saved (updated_at changes).
// No persistence — clears on app restart, which is intentional.

import type { Note } from "@/types";

// ─── Types ────────────────────────────────────────────────────────────────────

type ActionType = "summarize" | "tags" | "explain";

interface CacheEntry {
  content: string;
  tags?: string[];
  cachedAt: number;
}

// ─── Cache store ──────────────────────────────────────────────────────────────

const cache = new Map<string, CacheEntry>();

// ─── Key builder ──────────────────────────────────────────────────────────────

/**
 * Cache key includes updated_at so stale results are never served
 * after a note has been edited and saved.
 */
function buildKey(note: Note, action: ActionType): string {
  return `${note.id}:${action}:${note.updated_at}`;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function getCached(note: Note, action: ActionType): CacheEntry | null {
  const key = buildKey(note, action);
  return cache.get(key) ?? null;
}

export function setCached(
  note: Note,
  action: ActionType,
  entry: CacheEntry
): void {
  const key = buildKey(note, action);
  cache.set(key, { ...entry, cachedAt: Date.now() });
}

export function clearCacheForNote(noteId: string): void {
  for (const key of cache.keys()) {
    if (key.startsWith(noteId)) cache.delete(key);
  }
}

export function clearAllCache(): void {
  cache.clear();
}