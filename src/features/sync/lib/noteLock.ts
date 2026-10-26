// src/features/sync/lib/noteLock.ts
//
// Stage 4d.2 — one lock per note, shared by push and pull, so the two can never
// run on the same note at once (a pull racing a push, or the dirty scan pushing
// freshly pulled content back before its sync state is recorded).
//
// In-memory and non-blocking on purpose: callers that find the note busy skip it
// and rely on the next drain / dirty scan rather than waiting.

export type LockKind = "push" | "pull" | "reconcile";

const held = new Map<string, { kind: LockKind; token: symbol }>();

// Returns a release function, or null if the note is already locked.
// The release is idempotent and only releases the hold it was issued for.
export function tryLockNote(noteId: string, kind: LockKind): (() => void) | null {
  if (held.has(noteId)) return null;
  const token = Symbol(kind);
  held.set(noteId, { kind, token });
  return () => {
    if (held.get(noteId)?.token === token) held.delete(noteId);
  };
}

export function noteLockHolder(noteId: string): LockKind | null {
  return held.get(noteId)?.kind ?? null;
}