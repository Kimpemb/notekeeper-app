// src/features/sync/lib/conflictCopy.test.ts

import { describe, it, expect } from "vitest";
import { conflictCopyTitle, remapBlockIds } from "@/features/sync/lib/conflictCopy";

const counter = () => {
  let n = 0;
  return () => `new-${++n}`;
};

describe("conflictCopyTitle", () => {
  it("appends the suffix", () => {
    expect(conflictCopyTitle("Plan")).toBe("Plan (conflict copy)");
  });
  it("names an empty title Untitled", () => {
    expect(conflictCopyTitle("  ")).toBe("Untitled (conflict copy)");
  });
});

describe("remapBlockIds", () => {
  it("replaces ids on target types, including nested ones", () => {
    const doc = {
      type: "doc",
      content: [
        { type: "paragraph", attrs: { blockId: "a" }, content: [{ type: "text", text: "x" }] },
        {
          type: "toggle",
          attrs: { blockId: "t" },
          content: [
            { type: "toggleSummary", content: [{ type: "text", text: "s" }] },
            { type: "toggleBody", content: [{ type: "paragraph", attrs: { blockId: "p" } }] },
          ],
        },
      ],
    };
    const r = remapBlockIds(JSON.stringify(doc), counter());
    const out = JSON.parse(r.content);
    expect(out.content[0].attrs.blockId).toBe("new-1");
    expect(out.content[1].attrs.blockId).toBe("new-2");
    expect(out.content[1].content[1].content[0].attrs.blockId).toBe("new-3");
    expect([...r.mapping.entries()]).toEqual([["a", "new-1"], ["t", "new-2"], ["p", "new-3"]]);
  });

  it("leaves text and other attributes untouched", () => {
    const doc = { type: "doc", content: [{ type: "heading", attrs: { blockId: "h", level: 2 }, content: [{ type: "text", text: "T" }] }] };
    const out = JSON.parse(remapBlockIds(JSON.stringify(doc), counter()).content);
    expect(out.content[0].attrs).toEqual({ blockId: "new-1", level: 2 });
    expect(out.content[0].content[0].text).toBe("T");
  });

  it("does not touch a blockId on a non-target node (a reference)", () => {
    const doc = { type: "doc", content: [{ type: "blockRef", attrs: { blockId: "other-note-block" } }] };
    const r = remapBlockIds(JSON.stringify(doc), counter());
    expect(JSON.parse(r.content).content[0].attrs.blockId).toBe("other-note-block");
    expect(r.mapping.size).toBe(0);
  });

  it("skips target nodes with no id", () => {
    const doc = { type: "doc", content: [{ type: "paragraph" }] };
    const r = remapBlockIds(JSON.stringify(doc), counter());
    expect(r.mapping.size).toBe(0);
  });

  it("maps a repeated old id to one new id", () => {
    const doc = { type: "doc", content: [
      { type: "paragraph", attrs: { blockId: "dup" } },
      { type: "paragraph", attrs: { blockId: "dup" } },
    ] };
    const out = JSON.parse(remapBlockIds(JSON.stringify(doc), counter()).content);
    expect(out.content[0].attrs.blockId).toBe(out.content[1].attrs.blockId);
  });

  it("throws on invalid JSON", () => {
    expect(() => remapBlockIds("{nope", counter())).toThrow();
  });
});
