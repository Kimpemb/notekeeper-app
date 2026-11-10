// src/features/sync/lib/closeNoteLive.ts
//
// Stage 4d.3, step 14 ("close it for me"), Phase B1 a. LIVE file: it imports
// stores, so tests never import it (same rule as the other *Live.ts files).
//
// Closes a note that is open in a tab (either pane), waits until its editor
// has unmounted and its unmount-flush save has finished, then confirms the
// note is no longer open. Never throws.

import { useUIStore } from "@/features/ui/store/useUIStore";
import { useNoteStore } from "@/features/notes/store/useNoteStore";
import { waitForEditorsClosed, waitForSaves } from "@/features/editor/lib/pendingSaves";
import { isNoteOpen } from "./pullFromHostedSync";

export interface CloseNoteResult {
  /** The note is no longer open in any tab and is not the active note. */
  closed: boolean;
  /** Its editor unmounted and every save it started finished within the wait. */
  flushConfirmed: boolean;
  error?: string;
}

export async function closeNoteForReview(
  noteId: string,
  waitMs?: number
): Promise<CloseNoteResult> {
  try {
    const ui = useUIStore.getState();
    const inTabs = [...ui.tabs, ...ui.pane2Tabs].some((t) => t.noteId === noteId);
    if (inTabs) ui.closeTabsForNotes(new Set([noteId]));

    // closeTab does not clear activeNoteId, and isNoteOpen also checks it.
    const notes = useNoteStore.getState();
    if (notes.activeNoteId === noteId) notes.setActiveNote(null, true);

    // Order matters: the editor's unmount cleanup starts the save (counted by
    // trackSave) before the editor registration is released, so once the
    // editors are gone the save is already counted.
    const editorsGone = await waitForEditorsClosed(noteId, waitMs);
    const savesDone = await waitForSaves(noteId, waitMs);

    const closed = !isNoteOpen(noteId);
    return {
      closed,
      flushConfirmed: editorsGone && savesDone,
      ...(closed ? {} : { error: "The note is still open in a tab." }),
    };
  } catch (err) {
    return {
      closed: false,
      flushConfirmed: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}