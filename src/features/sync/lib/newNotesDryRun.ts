// src/features/sync/lib/newNotesDryRun.ts
//
// Stage 4d tombstones, step 6a — READ-ONLY. Counts hosted notes that are not
// purged and not present on this device (and have no local tombstone), and logs
// them. Writes nothing, anywhere. This is the safety gate for the new-note pull:
// any note listed here that was deliberately deleted before tombstones existed
// would be resurrected by it, so the list must be reviewed first.

import { getDb } from "@/features/notes/db/client";
import { supabase } from "@/features/sync/db/supabaseClient";
import { useSyncStore } from "@/features/sync/store/useSyncStore";

const PAGE = 1000;

export interface MissingHostedNote {
  id: string;
  title: string;
  trashed: boolean;
  revision: number;
}

export async function findHostedNotesMissingLocally(): Promise<MissingHostedNote[]> {
  const session = useSyncStore.getState().session;
  if (!session) return [];

  const db = await getDb();
  const localRows = await db.select<Array<{ id: string }>>(`SELECT id FROM notes`);
  const tombRows = await db.select<Array<{ note_id: string }>>(`SELECT note_id FROM note_tombstones`);
  const known = new Set<string>([...localRows.map((r) => r.id), ...tombRows.map((r) => r.note_id)]);

  const missing: MissingHostedNote[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from("notes")
      .select("id, title, revision, deleted_at")
      .eq("owner_id", session.user.id)
      .is("purged_at", null)
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`dry-run listing failed (${error.code ?? "?"}): ${error.message}`);
    const rows = (data ?? []) as Array<{ id: string; title: string; revision: number; deleted_at: string | null }>;
    for (const r of rows) {
      if (!known.has(r.id)) {
        missing.push({ id: r.id, title: r.title, trashed: r.deleted_at != null, revision: r.revision });
      }
    }
    if (rows.length < PAGE) break;
    from += PAGE;
  }
  return missing;
}

let done = false;

/** Logs once per app run. Never throws. */
export async function logNewNotesDryRun(): Promise<void> {
  if (done) return;
  try {
    const missing = await findHostedNotesMissingLocally();
    done = true;
    console.info(
      `[sync] dry run: ${missing.length} hosted note(s) not on this device (nothing was changed)`,
      missing.slice(0, 25)
    );
  } catch (err) {
    console.warn("[sync] dry run failed:", err);
  }
}
