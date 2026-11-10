// src/features/sync/lib/outcomeText.test.ts

import { describe, it, expect } from "vitest";
import { describeOutcome } from "@/features/sync/lib/outcomeText";

describe("describeOutcome — success", () => {
  it("keep mine says the other version was replaced and a backup saved", () => {
    const r = describeOutcome({ status: "committed", variant: "whole_keep_mine" });
    expect(r).toEqual({
      text: "Done. Your version now replaces the other device's version. A backup was saved.",
      tone: "success",
      changed: true,
    });
  });

  it("take theirs says the other version is now here", () => {
    const r = describeOutcome({ status: "committed", variant: "whole_take_theirs" });
    expect(r.text).toMatch(/now on this device/);
    expect(r.tone).toBe("success");
  });

  it("keep both mentions the new note", () => {
    const r = describeOutcome({ status: "committed", variant: "whole_keep_both", copyNoteId: "c1" });
    expect(r.text).toMatch(/new note/);
    expect(r.changed).toBe(true);
  });

  it("an unknown variant still says Done", () => {
    expect(describeOutcome({ status: "committed" }).text).toBe("Done.");
  });
});

describe("describeOutcome — delete reviews", () => {
  it("restore says nothing on the server changed", () => {
    expect(describeOutcome({ status: "committed", choice: "keep_it" }).text).toMatch(/Nothing on the server changed/);
  });

  it("delete everywhere says the note was deleted everywhere and a backup exists", () => {
    const r = describeOutcome({ status: "committed", choice: "delete_anyway" });
    expect(r.text).toMatch(/deleted everywhere/);
    expect(r.text).toMatch(/backup/);
  });

  it("keep mine says the note exists everywhere again", () => {
    expect(describeOutcome({ status: "committed", choice: "keep_mine" }).text).toMatch(/exists everywhere again/);
  });

  it("let the deletion stand says the note was deleted from this device", () => {
    expect(describeOutcome({ status: "committed", choice: "let_go" }).text).toMatch(/deleted from this device/);
  });

  it("all four are successes that refresh the list", () => {
    for (const choice of ["keep_it", "delete_anyway", "keep_mine", "let_go"]) {
      expect(describeOutcome({ status: "committed", choice })).toMatchObject({ tone: "success", changed: true });
    }
  });
});

describe("describeOutcome — nothing changed", () => {
  it("stale because the hosted note moved", () => {
    const r = describeOutcome({ status: "stale", reason: "hosted_moved" });
    expect(r.text).toMatch(/other device changed this note again/);
    expect(r).toMatchObject({ tone: "info", changed: false });
  });

  it("stale because this device changed it", () => {
    expect(describeOutcome({ status: "stale", reason: "local_changed" }).text).toMatch(/on this device while you were reviewing/);
  });

  it("every refusal says nothing was changed", () => {
    for (const reason of ["signed_out", "note_open", "busy", "backup_failed", "copy_failed", "rebuild_failed", "read_failed", "plan_failed", "something_new", undefined]) {
      const r = describeOutcome({ status: "refused", reason });
      expect(r.text).toMatch(/Nothing was changed|nothing was changed/);
      expect(r).toMatchObject({ tone: "error", changed: false });
    }
  });

  it("an open note tells the user to close the tab", () => {
    expect(describeOutcome({ status: "refused", reason: "note_open" }).text).toMatch(/Close it/);
  });

  it("only an open-note refusal offers to close the note", () => {
    expect(describeOutcome({ status: "refused", reason: "note_open" }).closeNote).toBe(true);
    for (const reason of ["signed_out", "busy", "backup_failed", "copy_failed", "rebuild_failed", "read_failed", "plan_failed", undefined]) {
      expect(describeOutcome({ status: "refused", reason }).closeNote).toBeUndefined();
    }
    expect(describeOutcome({ status: "committed", variant: "whole_keep_mine" }).closeNote).toBeUndefined();
    expect(describeOutcome({ status: "stale" }).closeNote).toBeUndefined();
  });

  it("push_lost leaves this device alone", () => {
    const r = describeOutcome({ status: "push_lost", hosted: "moved" });
    expect(r.text).toMatch(/Nothing on this device was changed/);
    expect(r.changed).toBe(false);
  });

  it("a network error that definitely did not apply says nothing changed", () => {
    const r = describeOutcome({ status: "network_error", maybeApplied: false });
    expect(r).toMatchObject({ tone: "error", changed: false });
  });

  it("a failed local write says nothing was sent and a backup exists", () => {
    const r = describeOutcome({ status: "local_failed" });
    expect(r.text).toMatch(/Nothing was sent to the server/);
    expect(r.text).toMatch(/backup/);
  });
});

describe("describeOutcome — uncertain or partial (never says nothing happened)", () => {
  it("a network error that may have applied warns and refreshes the list", () => {
    const r = describeOutcome({ status: "network_error", maybeApplied: true });
    expect(r.tone).toBe("warning");
    expect(r.changed).toBe(true);
    expect(r.text).toMatch(/not certain/);
    expect(r.text).toMatch(/Do not repeat/);
  });

  it("a committed change that could not be recorded warns", () => {
    const r = describeOutcome({ status: "committed_unrecorded" });
    expect(r).toMatchObject({ tone: "warning", changed: true });
    expect(r.text).toMatch(/Do not repeat/);
  });

  it("the server took it but this device did not finish", () => {
    const r = describeOutcome({ status: "server_won_local_failed" });
    expect(r).toMatchObject({ tone: "warning", changed: true });
    expect(r.text).toMatch(/server took the change/);
  });

  it("an unknown status is a warning that names it, not a success", () => {
    const r = describeOutcome({ status: "brand_new" });
    expect(r.tone).toBe("warning");
    expect(r.text).toContain("brand_new");
    expect(r.changed).toBe(true);
  });
});
