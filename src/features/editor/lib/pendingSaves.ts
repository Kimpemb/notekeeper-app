// src/features/editor/lib/pendingSaves.ts
//
// Stage 4d.3, step 14 ("close it for me") - PURE bookkeeping, no DB, no network,
// no React, no store imports. Two per-note counters:
//
//   - open editors: an editor for the note is mounted (registered by useAutoSave)
//   - pending saves: a save of the note's content has started and not yet finished
//
// Why it exists: closing a tab unmounts the editor, and the unmount cleanup in
// useAutoSave.ts saves unsaved edits fire-and-forget. Nothing could wait for that
// save. "Close it for me" waits here instead: first until the note's editors are
// gone, then until the saves they started have finished. Only after that is the
// local row safe to read.
//
// Both waits resolve true when the counter reached zero and false on timeout
// (never reject, never throw), so the caller can say plainly when it could not
// confirm the save.

class Gauge {
  private counts = new Map<string, number>();
  private waiters = new Map<string, Set<() => void>>();

  inc(id: string): () => void {
    this.counts.set(id, (this.counts.get(id) ?? 0) + 1);
    let done = false;
    // The returned release is idempotent: calling it twice releases once.
    return () => {
      if (done) return;
      done = true;
      this.dec(id);
    };
  }

  get(id: string): number {
    return this.counts.get(id) ?? 0;
  }

  waitForZero(id: string, timeoutMs: number): Promise<boolean> {
    if (this.get(id) === 0) return Promise.resolve(true);
    return new Promise<boolean>((resolve) => {
      let settled = false;
      const finish = (value: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.waiters.get(id)?.delete(onZero);
        if (this.waiters.get(id)?.size === 0) this.waiters.delete(id);
        resolve(value);
      };
      const onZero = () => finish(true);
      const timer = setTimeout(() => finish(false), timeoutMs);
      let set = this.waiters.get(id);
      if (!set) {
        set = new Set();
        this.waiters.set(id, set);
      }
      set.add(onZero);
    });
  }

  clear(): void {
    this.counts.clear();
    this.waiters.clear();
  }

  private dec(id: string): void {
    const next = (this.counts.get(id) ?? 0) - 1;
    if (next > 0) {
      this.counts.set(id, next);
      return;
    }
    this.counts.delete(id);
    const set = this.waiters.get(id);
    if (set) for (const fn of [...set]) fn();
  }
}

const editors = new Gauge();
const saves = new Gauge();

export const DEFAULT_WAIT_MS = 8000;

/** An editor for this note is now mounted. Call the returned function when it unmounts. */
export function registerEditor(noteId: string): () => void {
  return editors.inc(noteId);
}

/** A save of this note has started. Call the returned function when it finished (idempotent). */
export function beginSave(noteId: string): () => void {
  return saves.inc(noteId);
}

/** Wraps a save promise: counted as pending until it settles. Passes the result or error through. */
export function trackSave<T>(noteId: string, promise: Promise<T>): Promise<T> {
  const end = beginSave(noteId);
  return promise.then(
    (value) => {
      end();
      return value;
    },
    (err) => {
      end();
      throw err;
    }
  );
}

export function openEditorCount(noteId: string): number {
  return editors.get(noteId);
}

export function pendingSaveCount(noteId: string): number {
  return saves.get(noteId);
}

/** Resolves true when no editor for the note is mounted, false on timeout. */
export function waitForEditorsClosed(noteId: string, timeoutMs: number = DEFAULT_WAIT_MS): Promise<boolean> {
  return editors.waitForZero(noteId, timeoutMs);
}

/** Resolves true when no save of the note is in flight, false on timeout. */
export function waitForSaves(noteId: string, timeoutMs: number = DEFAULT_WAIT_MS): Promise<boolean> {
  return saves.waitForZero(noteId, timeoutMs);
}

/** Test helper: forget everything. */
export function resetPendingSaves(): void {
  editors.clear();
  saves.clear();
}
