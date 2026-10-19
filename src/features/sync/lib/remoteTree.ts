// src/features/sync/lib/remoteTree.ts
//
// Stage 4d.5 — lists the owner's hosted notes with the fields a download needs to
// plan its order: id, parent_id, revision, updated_at, deleted_at. Deliberately
// separate from fetchRemoteNoteMap() so the hot drain path keeps its small select.

import { supabase } from "@/features/sync/db/supabaseClient";
import type { RemoteTreeRow } from "@/features/sync/lib/downloadPlan";

const PAGE = 1000;

export async function fetchRemoteTree(ownerId: string): Promise<RemoteTreeRow[]> {
  const out: RemoteTreeRow[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from("notes")
      .select("id, parent_id, revision, updated_at, deleted_at")
      .eq("owner_id", ownerId)
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) {
      throw new Error(`remote tree fetch failed (${error.code ?? "?"}): ${error.message}`);
    }
    const rows = (data ?? []) as Array<{
      id: string;
      parent_id: string | null;
      revision: number;
      updated_at: string;
      deleted_at: string | null;
    }>;
    for (const r of rows) {
      out.push({
        id: r.id,
        parentId: r.parent_id,
        revision: r.revision,
        updatedAt: Date.parse(r.updated_at),
        deletedAt: r.deleted_at == null ? null : Date.parse(r.deleted_at),
      });
    }
    if (rows.length < PAGE) break;
    from += PAGE;
  }
  return out;
}
