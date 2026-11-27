// src/features/sync/lib/metaRevTriggerSql.ts
//
// Pure: finds the CREATE TRIGGER statement for notes_meta_rev_bump inside the
// app's migration list, so the sync guard recreates exactly what schema.ts defines.

export const META_REV_TRIGGER_NAME = "notes_meta_rev_bump";

export function metaRevTriggerSql(migrations: readonly string[]): string | null {
  // The LAST definition wins: a later migration may redefine the trigger.
  const matches = migrations.filter((s) =>
    /CREATE\s+TRIGGER\s+(IF\s+NOT\s+EXISTS\s+)?notes_meta_rev_bump\b/i.test(s)
  );
  return matches.length > 0 ? matches[matches.length - 1] : null;
}