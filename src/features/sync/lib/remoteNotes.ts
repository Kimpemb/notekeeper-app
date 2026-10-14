// src/features/sync/lib/remoteNotes.ts
//
// Fetches the owner's hosted notes as id → { revision, updatedAt }, paginated.
// Shared by the backfill and the sync-state seeding.

import { supabase } from "@/features/sync/db/supabaseClient";
import type { RemoteNoteInfo } from "@/features/sync/lib/syncDecision";

const REMOTE_PAGE = 1000;

export async function fetchRemoteNoteMap(ownerId: string): Promise<Map<string, RemoteNoteInfo>> {
  const map = new Map<string, RemoteNoteInfo>();
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from("notes")
      .select("id, revision, updated_at")
      .eq("owner_id", ownerId)
      .order("id")
      .range(from, from + REMOTE_PAGE - 1);
    if (error) {
      throw new Error(`remote note fetch failed (${error.code ?? "?"}): ${error.message}`);
    }
    for (const r of (data ?? []) as Array<{ id: string; revision: number; updated_at: string }>) {
      map.set(r.id, { revision: r.revision, updatedAt: Date.parse(r.updated_at) });
    }
    if (!data || data.length < REMOTE_PAGE) break;
    from += REMOTE_PAGE;
  }
  return map;
}
