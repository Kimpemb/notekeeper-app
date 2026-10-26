// src/features/sync/lib/formatDownloadSummary.test.ts
import { describe, it, expect } from "vitest";
import type { DownloadSummary } from "@/features/sync/lib/downloadVault";
import { downloadNeedsResume, formatDownloadSummary } from "./formatDownloadSummary";

const base: DownloadSummary = {
  listed: 0,
  planned: 0,
  inserted: 0,
  alreadyLocal: 0,
  trashed: 0,
  reparented: 0,
  recovered: 0,
  starterRemoved: 0,
  failed: 0,
  stopped: null,
};
const s = (o: Partial<DownloadSummary>): DownloadSummary => ({ ...base, ...o });

describe("downloadNeedsResume", () => {
  it("is false for a clean run and for a blocked run", () => {
    expect(downloadNeedsResume(s({ inserted: 10 }))).toBe(false);
    expect(downloadNeedsResume(s({ stopped: "blocked", blockedReason: "x" }))).toBe(false);
  });
  it("is true for cancelled, repeated failures, or any failed note", () => {
    expect(downloadNeedsResume(s({ stopped: "cancelled" }))).toBe(true);
    expect(downloadNeedsResume(s({ stopped: "too_many_failures" }))).toBe(true);
    expect(downloadNeedsResume(s({ inserted: 5, failed: 1 }))).toBe(true);
  });
});

describe("formatDownloadSummary", () => {
  it("reports a clean run with the indexing note", () => {
    const f = formatDownloadSummary(s({ inserted: 1974, trashed: 3 }));
    expect(f.ok).toBe(true);
    expect(f.needsResume).toBe(false);
    expect(f.headline).toBe("Downloaded 1974 notes.");
    expect(f.details).toContain("3 placed in the Trash");
    expect(f.details.some((d) => d.includes("indexing"))).toBe(true);
  });

  it("uses the singular for one note", () => {
    expect(formatDownloadSummary(s({ inserted: 1 })).headline).toBe("Downloaded 1 note.");
  });

  it("says nothing new when a rerun inserts zero", () => {
    const f = formatDownloadSummary(s({ alreadyLocal: 1974 }));
    expect(f.headline).toBe("Nothing new to download.");
    expect(f.ok).toBe(true);
    expect(f.details).toContain("1974 already on this device");
    expect(f.details.some((d) => d.includes("indexing"))).toBe(false);
  });

  it("offers resume when cancelled", () => {
    const f = formatDownloadSummary(s({ stopped: "cancelled", inserted: 40 }));
    expect(f.ok).toBe(false);
    expect(f.needsResume).toBe(true);
    expect(f.headline).toBe("Download cancelled. 40 notes downloaded so far.");
    expect(f.details).toContain("Resume to download the rest.");
  });

  it("states failures once for a finished-with-failures run", () => {
    const f = formatDownloadSummary(s({ inserted: 90, failed: 2 }));
    expect(f.headline).toBe("Download finished with 2 failed.");
    expect(f.details.filter((d) => d.includes("failed"))).toHaveLength(0);
    expect(f.needsResume).toBe(true);
  });

  it("lists failures in details when the run stopped early", () => {
    const f = formatDownloadSummary(s({ stopped: "too_many_failures", failed: 3 }));
    expect(f.headline).toBe("Download stopped after repeated failures.");
    expect(f.details).toContain("3 failed");
  });

  it("passes the blocked reason through and does not offer resume", () => {
    const f = formatDownloadSummary(s({ stopped: "blocked", blockedReason: "Close all open notes first." }));
    expect(f.headline).toBe("Couldn't start the download: Close all open notes first.");
    expect(f.needsResume).toBe(false);
    expect(f.ok).toBe(false);
  });

  it("includes reparented, recovered and starter counts", () => {
    const f = formatDownloadSummary(s({ inserted: 5, reparented: 2, recovered: 1, starterRemoved: 3 }));
    expect(f.details).toContain("2 placed at the top level (their parent wasn't available)");
    expect(f.details).toContain("1 finished from an interrupted run");
    expect(f.details).toContain("3 starter notes removed");
  });
});
