// src/features/sync/lib/downloadRow.test.ts
import { describe, it, expect } from "vitest";
import {
  remoteRowToInsertParams,
  INSERT_DOWNLOADED_NOTE_SQL,
  REMOTE_DOWNLOAD_COLUMNS,
  DOWNLOAD_LOCAL_REVISION,
  DOWNLOAD_LOCAL_META_REV,
  type RemoteDownloadRow,
} from "./downloadRow";

const row: RemoteDownloadRow = {
  id: "n1",
  title: "Hello",
  content: '{"type":"doc","content":[]}',
  plaintext: "hello",
  tags: '["a"]',
  parent_id: "p1",
  sort_order: 7,
  frontmatter: null,
  created_at: "2026-10-01T10:00:00.000Z",
  updated_at: "2026-10-14T12:30:00.500Z",
  deleted_at: null,
  revision: 11,
  is_published: true,
  publish_visibility: "public",
  publish_token: "tok",
  forked_from_note_id: null,
  forked_from_owner_id: null,
  fork_base_revision: null,
};

describe("remoteRowToInsertParams", () => {
  const params = remoteRowToInsertParams(row, "p1", "sync-1");

  it("supplies one value per placeholder in the SQL", () => {
    const placeholders = new Set(INSERT_DOWNLOADED_NOTE_SQL.match(/\$\d+/g));
    expect(params).toHaveLength(placeholders.size);
    expect(Math.max(...[...placeholders].map((p) => Number(p.slice(1))))).toBe(params.length);
  });

  it("converts ISO timestamps to epoch milliseconds, keeping the millisecond part", () => {
    expect(params[8]).toBe(Date.parse("2026-10-01T10:00:00.000Z"));
    expect(params[9]).toBe(Date.parse("2026-10-14T12:30:00.500Z"));
    expect(params[9]).toBe(1791981000500);
  });

  it("starts the local counters at revision 1 / meta_rev 0, not the hosted revision", () => {
    expect(params[12]).toBe(DOWNLOAD_LOCAL_REVISION);
    expect(params[13]).toBe(DOWNLOAD_LOCAL_META_REV);
    expect(params).not.toContain(row.revision);
  });

  it("never carries a deleted_at", () => {
    expect(params[10]).toBeNull();
  });

  it("uses the planned parent, not the hosted one", () => {
    expect(remoteRowToInsertParams(row, null, "s")[6]).toBeNull();
    expect(remoteRowToInsertParams(row, "other", "s")[6]).toBe("other");
  });

  it("maps booleans to 0/1 and passes publish/fork fields through", () => {
    expect(params[14]).toBe(1);
    expect(remoteRowToInsertParams({ ...row, is_published: false }, null, "s")[14]).toBe(0);
    expect(params[15]).toBe("public");
    expect(params[16]).toBe("tok");
  });

  it("uses INSERT OR IGNORE (never REPLACE, which would run delete triggers)", () => {
    expect(INSERT_DOWNLOADED_NOTE_SQL).toMatch(/^INSERT OR IGNORE INTO notes/);
    expect(INSERT_DOWNLOADED_NOTE_SQL).not.toMatch(/REPLACE/);
  });

  it("selects every hosted column the mapping reads", () => {
    for (const col of Object.keys(row)) expect(REMOTE_DOWNLOAD_COLUMNS).toContain(col);
  });
});
