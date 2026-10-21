// src/features/sync/lib/noteTombstones.test.ts
//
// Stage 4d tombstones, step 1. Replays the app's real ALL_MIGRATIONS (including
// the note_tombstones table and notes_tombstone_capture trigger now in
// schema.ts) into in-memory SQLite (better-sqlite3) and runs the delete shapes
// the app uses: deleteNote (subtree, deepest-first, one DELETE per note),
// emptyTrash (one bulk DELETE) and purgeTrashedNotes (DELETE with a cutoff).
// Replaces tombstoneTrigger.spike.test.ts.

import { describe, it, expect, beforeEach } from "vitest";
import { ALL_MIGRATIONS } from "@/features/notes/db/schema";

// better-sqlite3 has no type package in this repo; load it untyped.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let Database: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let db: any;

function replaySchema() {
  for (const sql of ALL_MIGRATIONS) {
    try {
      db.exec(sql);
    } catch (err) {
      const msg = String(err);
      // Same tolerance as initDb() in queries.ts.
      if (msg.includes("duplicate column name") || msg.includes("already exists")) continue;
      throw new Error(`Schema replay failed on:\n${sql}\n\n${msg}`);
    }
  }
}

function addNote(id: string, opts: { parent?: string | null; deletedAt?: number | null } = {}) {
  db.prepare(
    `INSERT INTO notes (id, sync_id, created_at, updated_at, parent_id, deleted_at)
     VALUES (?, ?, 1000, 1000, ?, ?)`
  ).run(id, `sync-${id}`, opts.parent ?? null, opts.deletedAt ?? null);
}

function addSyncState(id: string, serverRevision: number) {
  db.prepare(
    `INSERT INTO note_sync_state
       (note_id, synced_local_revision, synced_local_updated_at, synced_server_revision, synced_at)
     VALUES (?, 1, 1000, ?, 1000)`
  ).run(id, serverRevision);
}

const tombstones = () =>
  db.prepare(`SELECT note_id, synced_server_revision, state FROM note_tombstones ORDER BY note_id`).all();
const tombstoneIds = (): string[] => tombstones().map((t: { note_id: string }) => t.note_id);
const syncStateIds = (): string[] =>
  db.prepare(`SELECT note_id FROM note_sync_state ORDER BY note_id`).all().map((r: { note_id: string }) => r.note_id);

beforeEach(async () => {
  if (!Database) {
    Database = (await import("better-sqlite3" as string)).default;
  }
  db = new Database(":memory:");
  db.pragma("foreign_keys = ON"); // the app runs with foreign keys on
  replaySchema();
});

describe("note_tombstones capture (real migrations)", () => {
  it("captures the sync state BEFORE the cascade removes it", () => {
    addNote("n1");
    addSyncState("n1", 7);

    db.prepare(`DELETE FROM notes WHERE id = ?`).run("n1");

    expect(tombstones()).toEqual([{ note_id: "n1", synced_server_revision: 7, state: "pending" }]);
    expect(syncStateIds()).toEqual([]); // the cascade still ran
  });

  it("records nothing for a note without sync state (starter / never-synced)", () => {
    addNote("starter");
    db.prepare(`DELETE FROM notes WHERE id = ?`).run("starter");
    expect(tombstones()).toEqual([]);
  });

  it("emptyTrash shape: one bulk DELETE tombstones every trashed note, and only those", () => {
    addNote("p", { deletedAt: 5000 });
    addNote("c", { parent: "p", deletedAt: 5000 });
    addNote("live");
    for (const id of ["p", "c", "live"]) addSyncState(id, 3);

    db.prepare(`DELETE FROM notes WHERE deleted_at IS NOT NULL`).run();

    expect(tombstoneIds()).toEqual(["c", "p"]);
    expect(syncStateIds()).toEqual(["live"]);
  });

  it("purge-cutoff shape: only notes trashed before the cutoff are tombstoned", () => {
    addNote("old", { deletedAt: 1000 });
    addNote("recent", { deletedAt: 9000 });
    addNote("live");
    for (const id of ["old", "recent", "live"]) addSyncState(id, 2);

    db.prepare(`DELETE FROM notes WHERE deleted_at IS NOT NULL AND deleted_at < ?`).run(5000);

    expect(tombstoneIds()).toEqual(["old"]);
    expect(syncStateIds()).toEqual(["live", "recent"]);
  });

  it("deleteNote shape: subtree deleted deepest-first, one DELETE per note, each tombstoned", () => {
    addNote("p");
    addNote("c", { parent: "p" });
    addNote("g", { parent: "c" });
    for (const id of ["p", "c", "g"]) addSyncState(id, 4);

    for (const id of ["g", "c", "p"]) db.prepare(`DELETE FROM notes WHERE id = ?`).run(id);

    expect(tombstoneIds()).toEqual(["c", "g", "p"]);
  });

  it("is atomic with the delete: a rolled-back delete leaves no tombstone", () => {
    addNote("n1");
    addSyncState("n1", 9);

    db.exec("BEGIN");
    db.prepare(`DELETE FROM notes WHERE id = ?`).run("n1");
    db.exec("ROLLBACK");

    expect(tombstones()).toEqual([]);
    expect(syncStateIds()).toEqual(["n1"]);
  });

  it("FK SET NULL: a live child of an emptied parent is reparented and its meta_rev is bumped", () => {
    addNote("p", { deletedAt: 5000 });
    addNote("c", { parent: "p" });
    addSyncState("p", 2);
    addSyncState("c", 2);

    const before = db.prepare(`SELECT meta_rev FROM notes WHERE id = 'c'`).get().meta_rev;
    db.prepare(`DELETE FROM notes WHERE deleted_at IS NOT NULL`).run();
    const after = db.prepare(`SELECT parent_id, meta_rev FROM notes WHERE id = 'c'`).get();

    expect(after.parent_id).toBeNull();
    expect(after.meta_rev).toBeGreaterThan(before); // dirty scan will see the reparent
    expect(tombstones()).toEqual([{ note_id: "p", synced_server_revision: 2, state: "pending" }]);
  });

  it("migrations are idempotent: replaying them again keeps the table and trigger working", () => {
    expect(() => replaySchema()).not.toThrow();

    addNote("n1");
    addSyncState("n1", 5);
    db.prepare(`DELETE FROM notes WHERE id = ?`).run("n1");

    expect(tombstones()).toEqual([{ note_id: "n1", synced_server_revision: 5, state: "pending" }]);
  });
});