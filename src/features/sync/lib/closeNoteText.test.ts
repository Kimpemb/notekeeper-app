// src/features/sync/lib/closeNoteText.test.ts

import { describe, it, expect } from "vitest";
import { describeCloseResult } from "@/features/sync/lib/closeNoteText";

describe("describeCloseResult - closed and saved", () => {
  it("review screen: says closed and saved, then Back and reopen the review", () => {
    const r = describeCloseResult({ closed: true, flushConfirmed: true }, "review");
    expect(r).toEqual({
      text: "The note was closed and its latest edits were saved. Go Back and open the review again.",
      tone: "success",
      closed: true,
    });
  });

  it("backups screen: says closed and saved, then press Replace again", () => {
    const r = describeCloseResult({ closed: true, flushConfirmed: true }, "backups");
    expect(r.text).toBe("The note was closed and its latest edits were saved. Press Replace again.");
    expect(r.tone).toBe("success");
    expect(r.closed).toBe(true);
  });
});

describe("describeCloseResult - closed but the save could not be confirmed", () => {
  it("warns plainly, never claims the edits were saved", () => {
    for (const ctx of ["review", "backups"] as const) {
      const r = describeCloseResult({ closed: true, flushConfirmed: false }, ctx);
      expect(r.tone).toBe("warning");
      expect(r.closed).toBe(true);
      expect(r.text).toMatch(/could not confirm/);
      expect(r.text).not.toMatch(/edits were saved\./);
    }
  });

  it("points to the right next step per screen", () => {
    expect(describeCloseResult({ closed: true, flushConfirmed: false }, "review").text).toMatch(/open the review again/);
    expect(describeCloseResult({ closed: true, flushConfirmed: false }, "backups").text).toMatch(/Replace again/);
  });
});

describe("describeCloseResult - could not close", () => {
  it("is an error, says nothing was changed, and does not let the screen go on", () => {
    const r = describeCloseResult({ closed: false, flushConfirmed: false, error: "The note is still open in a tab." }, "review");
    expect(r.tone).toBe("error");
    expect(r.closed).toBe(false);
    expect(r.text).toMatch(/Nothing was changed/);
  });

  it("a thrown-error result reads the same and never leaks the raw error text", () => {
    const r = describeCloseResult({ closed: false, flushConfirmed: false, error: "TypeError: x is undefined" }, "backups");
    expect(r.text).not.toMatch(/TypeError/);
    expect(r.closed).toBe(false);
  });

  it("closed:false wins even if flushConfirmed is true", () => {
    const r = describeCloseResult({ closed: false, flushConfirmed: true }, "review");
    expect(r.tone).toBe("error");
  });
});
