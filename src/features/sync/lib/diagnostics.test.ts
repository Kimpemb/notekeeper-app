// src/features/sync/lib/diagnostics.test.ts
import { describe, expect, it } from "vitest";
import { buildDiagnostics, shortId, token, type DiagnosticsInput } from "./diagnostics";

const BASE: DiagnosticsInput = {
  generatedAt: Date.UTC(2026, 10, 12, 9, 30, 0),
  app: { version: "2.1.5", migrationCount: 120 },
};

const SYNC = {
  localRevision: 22,
  localMetaRev: 1,
  syncedLocalRevision: 17,
  syncedServerRevision: 13,
  syncedMetaRev: 1,
  hostedRevision: 14,
  hostedPurged: false,
  queueState: "remote_ahead",
  queueReason: "changed on both this device and the server",
  queueLocalRevision: 22,
  queueRemoteRevision: 14,
};

const REVIEW = {
  mode: "block",
  baseKind: "snapshot",
  counts: { auto: 1, pending: 2, resolved: 0, conflicts: 2, unchanged: 3 },
  mapSizes: { base: 6, theirs: 8, mine: 8 },
  gateReasons: [] as string[],
};

describe("buildDiagnostics", () => {
  it("prints the app section with an ISO time", () => {
    const text = buildDiagnostics(BASE);
    expect(text).toContain("[app]");
    expect(text).toContain("generated_at_utc: 2026-11-12T09:30:00.000Z");
    expect(text).toContain("app_version: 2.1.5");
    expect(text).toContain("schema_statements: 120");
  });

  it("omits sections that were not given", () => {
    const text = buildDiagnostics(BASE);
    expect(text).not.toContain("[note]");
    expect(text).not.toContain("[sync_state]");
    expect(text).not.toContain("[review]");
    expect(text).not.toContain("[last_outcome]");
    expect(text).not.toContain("[queue]");
    expect(text).not.toContain("[collect_errors]");
  });

  it("shortens the note id to 8 characters", () => {
    const text = buildDiagnostics({ ...BASE, noteId: "a8fdb89a-33a3-4236-bd82-e8c533f9e71a" });
    expect(text).toContain("note_id8: a8fdb89a");
    expect(text).not.toContain("33a3");
  });

  it("shows the sync numbers and the gaps that expose a false conflict", () => {
    const text = buildDiagnostics({ ...BASE, sync: SYNC });
    expect(text).toContain("hosted_revision: 14");
    expect(text).toContain("synced_server_revision: 13");
    expect(text).toContain("hosted_minus_synced_server: 1");
    expect(text).toContain("local_minus_synced_local: 5");
    expect(text).toContain("meta_rev_minus_synced: 0");
    expect(text).toContain("queue_state: remote_ahead");
    expect(text).toContain("hosted_purged: no");
  });

  it("prints n/a for missing numbers instead of NaN or undefined", () => {
    const text = buildDiagnostics({
      ...BASE,
      sync: {
        ...SYNC,
        hostedRevision: null,
        hostedPurged: null,
        syncedServerRevision: null,
        queueState: null,
        queueReason: null,
      },
    });
    expect(text).toContain("hosted_revision: n/a");
    expect(text).toContain("hosted_minus_synced_server: n/a");
    expect(text).toContain("hosted_purged: n/a");
    expect(text).toContain("queue_reason: n/a");
    expect(text).not.toContain("NaN");
    expect(text).not.toContain("undefined");
    expect(text).not.toContain("null");
  });

  it("prints the review section with the gate result", () => {
    const passed = buildDiagnostics({ ...BASE, review: REVIEW });
    expect(passed).toContain("mode: block");
    expect(passed).toContain("base_kind: snapshot");
    expect(passed).toContain("gate: passed");
    expect(passed).toContain("blocks_conflicts: 2");
    expect(passed).toContain("map_size_base: 6");

    const tripped = buildDiagnostics({
      ...BASE,
      review: { ...REVIEW, mode: "whole_note", baseKind: "none", mapSizes: { base: null, theirs: 8, mine: 9 }, gateReasons: ["container_differs", "untracked_differs"] },
    });
    expect(tripped).toContain("gate: tripped (container_differs, untracked_differs)");
    expect(tripped).toContain("map_size_base: n/a");
  });

  it("prints the last outcome", () => {
    const text = buildDiagnostics({
      ...BASE,
      outcome: { status: "network_error", reason: "timeout", variant: "block_merge", maybeApplied: true },
    });
    expect(text).toContain("status: network_error");
    expect(text).toContain("reason: timeout");
    expect(text).toContain("variant: block_merge");
    expect(text).toContain("maybe_applied: yes");
    expect(text).toContain("choice: n/a");
  });

  it("prints queue counts and collect errors", () => {
    const text = buildDiagnostics({
      ...BASE,
      queueCounts: { pending: 1, parked: 2, remoteAhead: 3 },
      collectErrors: ["hosted read failed"],
    });
    expect(text).toContain("retrying: 1");
    expect(text).toContain("parked: 2");
    expect(text).toContain("newer_on_server: 3");
    expect(text).toContain("- hosted read failed");
  });

  it("never prints fields it does not know about (no titles or text)", () => {
    const sneaky = {
      ...BASE,
      noteId: "a8fdb89a-33a3-4236-bd82-e8c533f9e71a",
      sync: { ...SYNC, title: "SECRET TITLE", content: "SECRET BODY" },
      review: { ...REVIEW, mineContent: "SECRET MINE", theirsContent: "SECRET THEIRS", title: "SECRET TITLE" },
      outcome: { status: "committed", copyNoteId: "SECRET-COPY-ID", title: "SECRET TITLE" },
    } as unknown as DiagnosticsInput;
    const text = buildDiagnostics(sneaky);
    expect(text).not.toContain("SECRET");
  });

  it("strips odd characters from free-text values", () => {
    const text = buildDiagnostics({
      ...BASE,
      sync: { ...SYNC, queueReason: "bad {\"x\": 'y'}\nnext line <b>" },
    });
    const line = text.split("\n").find((l) => l.startsWith("queue_reason:")) ?? "";
    expect(line).not.toContain("{");
    expect(line).not.toContain('"');
    expect(line).not.toContain("'");
    expect(text.split("\n").filter((l) => l.startsWith("queue_reason:")).length).toBe(1);
  });
});

describe("token and shortId", () => {
  it("token caps length at 80 and handles empty values", () => {
    expect(token("a".repeat(200)).length).toBe(80);
    expect(token("")).toBe("n/a");
    expect(token(null)).toBe("n/a");
    expect(token(undefined)).toBe("n/a");
    expect(token("   ")).toBe("n/a");
  });

  it("shortId handles missing ids", () => {
    expect(shortId(null)).toBe("n/a");
    expect(shortId(undefined)).toBe("n/a");
    expect(shortId("")).toBe("n/a");
    expect(shortId("abcdef12-3456")).toBe("abcdef12");
  });
});
