// src/features/sync/lib/ensureMetaRevTrigger.ts
//
// Safety net: sync reads notes.meta_rev to see rename / move / trash edits. If the
// trigger that bumps it is ever missing, those edits are invisible to sync and a
// pull could overwrite them. Called at the start of every drain; recreates the
// trigger from schema.ts if it is gone and logs when that happens.

import { getDb } from "@/features/notes/db/client";
import { ALL_MIGRATIONS } from "@/features/notes/db/schema";
import { META_REV_TRIGGER_NAME, metaRevTriggerSql } from "@/features/sync/lib/metaRevTriggerSql";

export async function ensureMetaRevTrigger(): Promise<void> {
  try {
    const db = await getDb();
    const rows = await db.select<{ name: string }[]>(
      `SELECT name FROM sqlite_master WHERE type = 'trigger' AND name = $1`,
      [META_REV_TRIGGER_NAME]
    );
    if (rows.length > 0) return;

    const sql = metaRevTriggerSql(ALL_MIGRATIONS);
    if (!sql) {
      console.warn("[sync] meta_rev trigger is missing and its definition was not found");
      return;
    }
    await db.execute(sql.replace(/CREATE\s+TRIGGER\s+(IF\s+NOT\s+EXISTS\s+)?/i, "CREATE TRIGGER IF NOT EXISTS "));
    console.warn("[sync] meta_rev trigger was missing, recreated");
  } catch (err) {
    console.warn("[sync] meta_rev trigger check failed:", err);
  }
}