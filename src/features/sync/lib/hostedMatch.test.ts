// src/features/sync/lib/hostedMatch.test.ts

import { describe, it, expect } from "vitest";
import { compareWithHosted, healVerdict, type LocalCompare, type HostedCompare } from "./hostedMatch";

const T = Date.parse("2026-11-12T13:00:00.123Z");

const local = (over: Partial<LocalCompare> = {}): LocalCompare => ({
  title: "Note",
  content: '{"type":"doc","content":[{"type":"paragraph","attrs":{"blockId":"a"}}]}',
  plaintext: "hello",
  tags: '["x"]',
  parent_id: null,
  sort_order: 3,
  frontmatter: null,
  updated_at: T,
  deleted_at: null,
  ...over,
});

const hosted = (over: Partial<HostedCompare> = {}): HostedCompare => ({
  revision: 5,
  title: "Note",
  content: '{"type":"doc","content":[{"type":"paragraph","attrs":{"blockId":"a"}}]}',
  plaintext: "hello",
  tags: '["x"]',
  parent_id: null,
  sort_order: 3,
  frontmatter: null,
  updated_at: "2026-11-12T13:00:00.123+00:00",
  deleted_at: null,
  purged_at: null,
  ...over,
});

describe("compareWithHosted", () => {
  it("identical rows have no differences", () => {
    expect(compareWithHosted(local(), hosted())).toEqual([]);
  });

  it.each([
    ["title", { title: "Other" }],
    ["plaintext", { plaintext: "hello!" }],
    ["parent_id", { parent_id: "p1" }],
    ["sort_order", { sort_order: 4 }],
    ["updated_at", { updated_at: "2026-11-12T13:00:00.124+00:00" }],
    ["deleted_at", { deleted_at: "2026-11-12T13:00:00.123+00:00" }],
    ["purged_at", { purged_at: "2026-11-12T13:00:00.123+00:00" }],
    ["content", { content: '{"type":"doc","content":[]}' }],
    ["tags", { tags: '["y"]' }],
    ["frontmatter", { frontmatter: "{}" }],
  ])("detects a different %s", (name, over) => {
    expect(compareWithHosted(local(), hosted(over as Partial<HostedCompare>))).toEqual([name]);
  });

  it("lists every differing field", () => {
    const d = compareWithHosted(local(), hosted({ title: "x", plaintext: "y" }));
    expect(d).toEqual(["title", "plaintext"]);
  });

  it("ignores key order and whitespace in content (jsonb round trip)", () => {
    const h = hosted({ content: '{ "content": [ {"attrs": {"blockId": "a"}, "type": "paragraph"} ], "type": "doc" }' });
    expect(compareWithHosted(local(), h)).toEqual([]);
  });

  it("accepts parsed JSON objects from the hosted side", () => {
    const h = hosted({
      content: { type: "doc", content: [{ type: "paragraph", attrs: { blockId: "a" } }] },
      tags: ["x"],
    });
    expect(compareWithHosted(local(), h)).toEqual([]);
  });

  it("non-JSON strings must match exactly", () => {
    expect(compareWithHosted(local({ content: "not json" }), hosted({ content: "not json" }))).toEqual([]);
    expect(compareWithHosted(local({ content: "not json" }), hosted({ content: "not jsoN" }))).toEqual(["content"]);
  });

  it("null and empty string are different for tags", () => {
    expect(compareWithHosted(local({ tags: null }), hosted({ tags: "" }))).toEqual(["tags"]);
    expect(compareWithHosted(local({ tags: null }), hosted({ tags: null }))).toEqual([]);
  });

  it("an unparseable hosted timestamp counts as different", () => {
    expect(compareWithHosted(local(), hosted({ updated_at: "garbage" }))).toEqual(["updated_at"]);
  });

  it("a null hosted sort_order is not 0", () => {
    expect(compareWithHosted(local({ sort_order: 0 }), hosted({ sort_order: null }))).toEqual(["sort_order"]);
  });

  it("accepts a numeric-string sort_order", () => {
    expect(compareWithHosted(local(), hosted({ sort_order: "3" }))).toEqual([]);
  });

  it("matches deleted_at as the same instant", () => {
    const ms = Date.parse("2026-11-01T00:00:00.000Z");
    expect(compareWithHosted(local({ deleted_at: ms }), hosted({ deleted_at: "2026-11-01T00:00:00+00:00" }))).toEqual([]);
  });
});

describe("healVerdict", () => {
  it("heals identical rows after both_changed", () => {
    expect(healVerdict("both_changed", 5, hosted(), local())).toEqual({ heal: true });
  });

  it("heals identical rows with no_base", () => {
    expect(healVerdict("no_base", 5, hosted(), local())).toEqual({ heal: true });
  });

  it("never heals a regressed local or server", () => {
    expect(healVerdict("local_regressed", 5, hosted(), local()).heal).toBe(false);
    expect(healVerdict("server_regressed", 5, hosted(), local()).heal).toBe(false);
  });

  it("does not heal when hosted moved since the decision", () => {
    const v = healVerdict("both_changed", 4, hosted({ revision: 5 }), local());
    expect(v).toEqual({ heal: false, why: "hosted moved (r4 -> r5)" });
  });

  it("does not heal when anything differs, and says what", () => {
    const v = healVerdict("both_changed", 5, hosted({ title: "Other" }), local());
    expect(v).toEqual({ heal: false, why: "differs: title" });
  });

  it("never heals a purged hosted row", () => {
    const v = healVerdict("both_changed", 5, hosted({ purged_at: "2026-11-12T00:00:00Z" }), local());
    expect(v.heal).toBe(false);
  });
});
