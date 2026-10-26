// src/features/sync/lib/reconcileStore.test.ts
//
// Real SQL: the app's ALL_MIGRATIONS replayed into in-memory SQLite
// (better-sqlite3), with a thin adapter that turns $1-style placeholders into
// plain ? so the same SQL the app runs under tauri-plugin-sql runs here.

import { describe, it, expect, beforeEach } from "vitest";
import { ALL_MIGRATIONS } from "@/features/notes/db/schema";
import {
  BACKUPS_PER_NOTE,
  RETENTION_MS,
  deleteChoices,
  listBackups,
  loadChoices,
  pruneReconcileData,
  saveChoice,
  writeBackup,
  type BackupInput,
  type SqlDb,
} from "./reconcileStore";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let Database: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let raw: any;
let db: SqlDb;

function replaySchema() {
  for (const sql of ALL_MIGRATIONS) {
    try {
      raw.exec(sql);
    } catch (err) {
      const msg = String(err);
      if (msg.includes("duplicate column name") || msg.includes("already exists")) continue;
      throw new Error(`Schema replay failed on:\n${sql}\n\n${msg}`);
    }
  }
}

// better-sqlite3 treats ?1-style placeholders as named parameters, so turn each
// $n into a plain ? (in order of appearance) and repeat the values as needed.
function adapt(r: typeof raw): SqlDb {
  const prep = (sql: string, params: unknown[]) => {
    const order: number[] = [];
    const text = sql.replace(/\$(\d+)/g, (_m, n: string) => {
      order.push(Number(n));
      return "?";
    });
    return { text, values: order.map((n) => params[n - 1]) };
  };
  return {
    execute: async (sql, params = []) => {
      const p = prep(sql, params);
      return r.prepare(p.text).run(...p.values);
    },
    select: async <T,>(sql: string, params: unknown[] = []) => {
      const p = prep(sql, params);
      return r.prepare(p.text).all(...p.values) as T;
    },
  };
}

const backup = (over: Partial<BackupInput> = {}): BackupInput => ({
  noteId: "n1",
  kind: "merge",
  hostedRevision: 4,
  mineTitle: "Mine",
  mineContent: '{"type":"doc"}',
  theirsTitle: "Theirs",
  theirsContent: '{"type":"doc","content":[]}',
  ...over,
});

const item = (blockId: string, mine?: string, theirs?: string) => ({
  blockId,
  mine: mine ? { hash: mine } : undefined,
  theirs: theirs ? { hash: theirs } : undefined,
});

beforeEach(async () => {
  if (!Database) Database = (await import("better-sqlite3" as string)).default;
  raw = new Database(":memory:");
  raw.pragma("foreign_keys = ON");
  replaySchema();
  db = adapt(raw);
});

describe("reconcile_backups", () => {
  it("stores both versions and reads them back newest first", async () => {
    await writeBackup(db, backup(), 1000);
    await writeBackup(db, backup({ mineTitle: "Mine 2" }), 2000);
    const rows = await listBackups(db, "n1");
    expect(rows.map((r) => r.mine_title)).toEqual(["Mine 2", "Mine"]);
    expect(rows[0]).toMatchObject({ kind: "merge", hosted_revision: 4, theirs_title: "Theirs" });
  });

  it("keeps only the newest BACKUPS_PER_NOTE per note, and leaves other notes alone", async () => {
    for (let i = 0; i < BACKUPS_PER_NOTE + 3; i++) await writeBackup(db, backup({ mineTitle: `v${i}` }), 1000 + i);
    await writeBackup(db, backup({ noteId: "other" }), 5000);
    const rows = await listBackups(db, "n1");
    expect(rows).toHaveLength(BACKUPS_PER_NOTE);
    expect(rows[0].mine_title).toBe(`v${BACKUPS_PER_NOTE + 2}`);
    expect(await listBackups(db, "other")).toHaveLength(1);
  });

  it("survives the note itself being deleted (no foreign key)", async () => {
    raw.prepare(`INSERT INTO notes (id, sync_id, created_at, updated_at) VALUES ('n1','s1',1,1)`).run();
    await writeBackup(db, backup({ kind: "purge" }), 1000);
    raw.prepare(`DELETE FROM notes WHERE id = 'n1'`).run();
    expect(await listBackups(db, "n1")).toHaveLength(1);
  });

  it("prunes backups older than the retention window", async () => {
    const now = 10 * RETENTION_MS;
    await writeBackup(db, backup({ noteId: "old" }), now - RETENTION_MS - 1);
    await writeBackup(db, backup({ noteId: "fresh" }), now - 1000);
    await pruneReconcileData(db, now);
    expect(await listBackups(db, "old")).toHaveLength(0);
    expect(await listBackups(db, "fresh")).toHaveLength(1);
  });
});

describe("reconcile_choices", () => {
  it("returns a saved choice while both hashes still match", async () => {
    await saveChoice(db, "u1", "n1", item("B1", "m1", "t1"), "take_theirs", 1000);
    expect(await loadChoices(db, "u1", "n1", [item("B1", "m1", "t1")])).toEqual({ B1: "take_theirs" });
  });

  it("ignores a choice when either side's hash changed", async () => {
    await saveChoice(db, "u1", "n1", item("B1", "m1", "t1"), "keep_mine", 1000);
    expect(await loadChoices(db, "u1", "n1", [item("B1", "m2", "t1")])).toEqual({});
    expect(await loadChoices(db, "u1", "n1", [item("B1", "m1", "t2")])).toEqual({});
  });

  it("handles a block missing on one side (empty hash)", async () => {
    await saveChoice(db, "u1", "n1", item("B1", "m1", undefined), "keep_local", 1000);
    expect(await loadChoices(db, "u1", "n1", [item("B1", "m1", undefined)])).toEqual({ B1: "keep_local" });
    expect(await loadChoices(db, "u1", "n1", [item("B1", "m1", "t1")])).toEqual({});
  });

  it("replaces an earlier choice for the same block", async () => {
    await saveChoice(db, "u1", "n1", item("B1", "m1", "t1"), "keep_mine", 1000);
    await saveChoice(db, "u1", "n1", item("B1", "m1", "t1"), "take_theirs", 2000);
    expect(await loadChoices(db, "u1", "n1", [item("B1", "m1", "t1")])).toEqual({ B1: "take_theirs" });
  });

  it("never returns another user's choices", async () => {
    await saveChoice(db, "u1", "n1", item("B1", "m1", "t1"), "take_theirs", 1000);
    expect(await loadChoices(db, "u2", "n1", [item("B1", "m1", "t1")])).toEqual({});
  });

  it("deleteChoices clears one user's choices for one note only", async () => {
    await saveChoice(db, "u1", "n1", item("B1", "m1", "t1"), "keep_mine", 1000);
    await saveChoice(db, "u1", "n2", item("B1", "m1", "t1"), "keep_mine", 1000);
    await saveChoice(db, "u2", "n1", item("B1", "m1", "t1"), "keep_mine", 1000);
    await deleteChoices(db, "u1", "n1");
    expect(await loadChoices(db, "u1", "n1", [item("B1", "m1", "t1")])).toEqual({});
    expect(await loadChoices(db, "u1", "n2", [item("B1", "m1", "t1")])).toEqual({ B1: "keep_mine" });
    expect(await loadChoices(db, "u2", "n1", [item("B1", "m1", "t1")])).toEqual({ B1: "keep_mine" });
  });

  it("prunes choices older than the retention window", async () => {
    const now = 10 * RETENTION_MS;
    await saveChoice(db, "u1", "n1", item("OLD", "m", "t"), "keep_mine", now - RETENTION_MS - 1);
    await saveChoice(db, "u1", "n1", item("NEW", "m", "t"), "keep_mine", now - 1000);
    await pruneReconcileData(db, now);
    expect(await loadChoices(db, "u1", "n1", [item("OLD", "m", "t"), item("NEW", "m", "t")])).toEqual({ NEW: "keep_mine" });
  });
});

describe("migrations", () => {
  it("are idempotent: replaying them again keeps the tables working", async () => {
    expect(() => replaySchema()).not.toThrow();
    await writeBackup(db, backup(), 1000);
    expect(await listBackups(db, "n1")).toHaveLength(1);
  });
});
