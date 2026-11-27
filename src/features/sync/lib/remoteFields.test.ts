// src/features/sync/lib/remoteFields.test.ts
import { describe, it, expect } from "vitest";
import { toRemoteFields, type RemoteFieldsSource } from "./remoteFields";

const base: RemoteFieldsSource = {
  title: "Spec",
  content: '{"type":"doc","content":[]}',
  plaintext: "spec",
  tags: null,
  parent_id: "p1",
  sort_order: 3,
  frontmatter: null,
  created_at: Date.parse("2026-11-01T10:00:00.000Z"),
  updated_at: Date.parse("2026-11-26T12:00:00.500Z"),
  deleted_at: null,
  forked_from_note_id: "src1",
  forked_from_owner_id: "owner1",
  fork_base_revision: 4,
};

const SHARE_KEYS = ["is_published", "publish_visibility", "publish_token"];

describe("toRemoteFields", () => {
  it("never contains share-state keys", () => {
    const keys = Object.keys(toRemoteFields(base, 5));
    for (const k of SHARE_KEYS) expect(keys).not.toContain(k);
  });

  it("still omits share-state keys when the local row carries stale share values", () => {
    const stale = { ...base, is_published: 1, publish_visibility: "team", publish_token: "tok" };
    const out = toRemoteFields(stale, 5) as Record<string, unknown>;
    for (const k of SHARE_KEYS) expect(k in out).toBe(false);
  });

  it("keeps the fork columns", () => {
    const out = toRemoteFields(base, 5);
    expect(out.forked_from_note_id).toBe("src1");
    expect(out.forked_from_owner_id).toBe("owner1");
    expect(out.fork_base_revision).toBe(4);
  });

  it("uses the server revision and converts timestamps", () => {
    const out = toRemoteFields({ ...base, deleted_at: Date.parse("2026-11-26T13:00:00.000Z") }, 9);
    expect(out.revision).toBe(9);
    expect(out.created_at).toBe("2026-11-01T10:00:00.000Z");
    expect(out.updated_at).toBe("2026-11-26T12:00:00.500Z");
    expect(out.deleted_at).toBe("2026-11-26T13:00:00.000Z");
    expect(toRemoteFields(base, 9).deleted_at).toBeNull();
  });
});