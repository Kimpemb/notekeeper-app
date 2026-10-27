// src/features/sync/lib/localWriteSql.ts
//
// Stage 4d.3, batch 3b — the local compare-and-swap UPDATE for a commit, as pure
// SQL text plus parameters. Kept apart from commitLive.ts (which imports the
// Supabase client) so a test can run it against the real schema and triggers.
//
// Only the fields in `fields` are written. The UPDATE matches the row only if
// (revision, meta_rev, updated_at) are exactly what the review read; zero rows
// affected means something changed it since.

import type { LocalFields } from "@/features/sync/lib/commitPlan";

export const LOCAL_COLUMNS: ReadonlyArray<keyof LocalFields> = [
  "title",
  "content",
  "plaintext",
  "tags",
  "parent_id",
  "sort_order",
  "frontmatter",
  "updated_at",
  "deleted_at",
];

export interface LocalStamp {
  revision: number;
  metaRev: number;
  updatedAt: number;
}

/** null when there is nothing to write. Placeholders are $1..$n (tauri-plugin-sql style). */
export function buildLocalUpdate(
  noteId: string,
  fields: LocalFields,
  expected: LocalStamp
): { sql: string; params: unknown[] } | null {
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const col of LOCAL_COLUMNS) {
    const value = fields[col];
    if (value === undefined) continue; // undefined = not written; null is a real value
    params.push(value);
    sets.push(`${col} = $${params.length}`);
  }
  if (sets.length === 0) return null;

  const n = params.length;
  params.push(noteId, expected.revision, expected.metaRev, expected.updatedAt);
  return {
    sql: `UPDATE notes SET ${sets.join(", ")}
     WHERE id = $${n + 1} AND revision = $${n + 2} AND meta_rev = $${n + 3} AND updated_at = $${n + 4}`,
    params,
  };
}
