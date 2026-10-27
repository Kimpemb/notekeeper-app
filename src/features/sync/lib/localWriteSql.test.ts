// src/features/sync/lib/localWriteSql.test.ts
//
// Real SQL: the app's ALL_MIGRATIONS (including the revision and meta_rev
// triggers) replayed into in-memory SQLite (better-sqlite3). Proves what the
// commit's local write does to revision / meta_rev, which commitPlan's
// expectedLocalAfter assumes, and that a stale stamp writes nothing.

import { describe, it, expect, beforeEach } from "vitest";
import { ALL_MIGRATIONS } from "@/features/notes/db/schema";
import type { SqlDb } from "./reconcileStore";
import { buildLocalUpdate, type LocalStamp } from "./localWriteSql";
import type { LocalFields } from "./commitPlan";

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
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function adapt(r: any): SqlDb {
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

const STAMP: LocalStamp = { revision: 3, metaRev: 2, updatedAt: 1000 };

interface Row {
  title: string;
  content: string;
  plaintext: string;
  parent_id: string | null;
  sort_order: number | null;
  deleted_at: number | null;
  revision: number;
  meta_rev: number;
  updated_at: number;
}

const getRow = (): Row =>
  raw
    .prepare(
      `SELECT title, content, plaintext, parent_id, sort_order, deleted_at, revision, meta_rev, updated_at
       FROM notes WHERE id = 'n1'`
    )
    .get();

/** Returns the number of rows the UPDATE matched, or null when there was nothing to write. */
async function write(fields: LocalFields, stamp: LocalStamp = STAMP): Promise<number | null> {
  const u = buildLocalUpdate("n1", fields, stamp);
  if (!u) return null;
  const res = await db.execute(u.sql, u.params);
  return (res as unknown as { changes: number }).changes;
}

beforeEach(async () => {
  if (!Database) Database = (await import("better-sqlite3" as string)).default;
  raw = new Database(":memory:");
  raw.pragma("foreign_keys = ON");
  replaySchema();
  db = adapt(raw);
  raw
    .prepare(
      `INSERT INTO notes (id, sync_id, title, content, plaintext, created_at, updated_at)
       VALUES ('n1', 's1', 'Old', '{"v":1}', 'old', 1, 1000)`
    )
    .run();
  raw.prepare(`UPDATE notes SET revision = 3, meta_rev = 2 WHERE id = 'n1'`).run();
});

describe("buildLocalUpdate (pure)", () => {
  it("returns null when there is nothing to write", () => {
    expect(buildLocalUpdate("n1", {}, STAMP)).toBeNull();
  });

  it("writes only the given fields, keeps null as a real value, and numbers placeholders in order", () => {
    const u = buildLocalUpdate("n1", { title: "T", deleted_at: null, updated_at: 5 }, STAMP);
    expect(u?.sql).toContain("title = $1, updated_at = $2, deleted_at = $3");
    expect(u?.sql).toContain("WHERE id = $4 AND revision = $5 AND meta_rev = $6 AND updated_at = $7");
    expect(u?.params).toEqual(["T", 5, null, "n1", 3, 2, 1000]);
  });
});

describe("the local write against the real triggers", () => {
  it("a content change bumps revision by 1 and leaves meta_rev alone", async () => {
    expect(await write({ content: '{"v":2}', plaintext: "new", updated_at: 2000 })).toBe(1);
    expect(getRow()).toMatchObject({ content: '{"v":2}', plaintext: "new", revision: 4, meta_rev: 2, updated_at: 2000 });
  });

  it("a metadata change bumps meta_rev by 1 and leaves revision alone", async () => {
    expect(await write({ title: "New", updated_at: 2000 })).toBe(1);
    expect(getRow()).toMatchObject({ title: "New", revision: 3, meta_rev: 3, updated_at: 2000 });
  });

  it("content and metadata together bump both, once each", async () => {
    expect(await write({ content: '{"v":2}', title: "New", sort_order: 7, updated_at: 2000 })).toBe(1);
    expect(getRow()).toMatchObject({ revision: 4, meta_rev: 3 });
  });

  it("writing the same content and the same title bumps nothing", async () => {
    expect(await write({ content: '{"v":1}', title: "Old", updated_at: 2000 })).toBe(1);
    expect(getRow()).toMatchObject({ revision: 3, meta_rev: 2, updated_at: 2000 });
  });

  it("only updated_at changes nothing else (this is the 'agreed time' write)", async () => {
    expect(await write({ updated_at: 2000 })).toBe(1);
    expect(getRow()).toMatchObject({ revision: 3, meta_rev: 2, updated_at: 2000 });
  });

  it("trashing bumps meta_rev; restoring (deleted_at null) bumps it again", async () => {
    expect(await write({ deleted_at: 1500, updated_at: 2000 })).toBe(1);
    expect(getRow()).toMatchObject({ deleted_at: 1500, meta_rev: 3 });
    expect(await write({ deleted_at: null, updated_at: 3000 }, { revision: 3, metaRev: 3, updatedAt: 2000 })).toBe(1);
    expect(getRow()).toMatchObject({ deleted_at: null, meta_rev: 4, updated_at: 3000 });
  });

  it.each([
    ["revision", { revision: 2, metaRev: 2, updatedAt: 1000 }],
    ["meta_rev", { revision: 3, metaRev: 1, updatedAt: 1000 }],
    ["updated_at", { revision: 3, metaRev: 2, updatedAt: 999 }],
  ])("a stale %s updates zero rows and changes nothing", async (_name, stamp) => {
    const before = getRow();
    expect(await write({ content: '{"v":2}', title: "New", updated_at: 2000 }, stamp)).toBe(0);
    expect(getRow()).toEqual(before);
  });
});
