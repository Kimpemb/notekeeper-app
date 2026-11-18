// src/features/sync/lib/metaRevTriggerSql.test.ts
import { describe, it, expect } from "vitest";
import { metaRevTriggerSql } from "@/features/sync/lib/metaRevTriggerSql";
import { ALL_MIGRATIONS } from "@/features/notes/db/schema";

describe("metaRevTriggerSql", () => {
  it("finds the create statement, not the drop", () => {
    const sql = metaRevTriggerSql([
      "DROP TRIGGER IF EXISTS notes_meta_rev_bump",
      "CREATE TRIGGER notes_meta_rev_bump AFTER UPDATE ON notes BEGIN SELECT 1; END",
    ]);
    expect(sql).toContain("CREATE TRIGGER notes_meta_rev_bump");
  });

  it("returns null when there is none", () => {
    expect(metaRevTriggerSql(["CREATE TABLE x (a INTEGER)"])).toBeNull();
  });

  it("finds it in the real migration list and it bumps meta_rev", () => {
    const sql = metaRevTriggerSql(ALL_MIGRATIONS);
    expect(sql).not.toBeNull();
    expect(sql).toContain("meta_rev = meta_rev + 1");
  });
});