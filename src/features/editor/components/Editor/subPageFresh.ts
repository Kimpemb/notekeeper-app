// src/features/editor/components/Editor/subPageFresh.ts
//
// Tells a sub-page placeholder that was JUST inserted from the slash menu apart from one that was
// loaded from saved content (for example after the tab was closed before the name was confirmed).

let freshAt = 0;

/** Call right before inserting a placeholder (noteId: null, mode "editing"). */
export function markSubPageInserted(): void {
  freshAt = Date.now();
}

/** True when a placeholder mounting now was inserted a moment ago, not restored from storage. */
export function wasSubPageJustInserted(windowMs = 2000): boolean {
  return Date.now() - freshAt < windowMs;
}