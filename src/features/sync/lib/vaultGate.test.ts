// src/features/sync/lib/vaultGate.test.ts
import { describe, it, expect, vi } from "vitest";

// The module imports Tauri/Supabase-backed code; only the pure decision is tested here.
vi.mock("@/features/notes/db/client", () => ({ getDb: vi.fn() }));
vi.mock("@/features/notes/db/queries", () => ({ getSetting: vi.fn(), setSetting: vi.fn() }));
vi.mock("@/features/sync/db/supabaseClient", () => ({ supabase: {}, isSyncConfigured: false }));
vi.mock("@/features/sync/store/useSyncStore", () => ({ useSyncStore: { getState: () => ({}) } }));

import { decideVaultGate } from "./vaultGate";

describe("decideVaultGate", () => {
  it("is open once resolved, whatever else is true", () => {
    expect(decideVaultGate({ resolved: true, syncStateCount: 0, remoteCount: 500 })).toBe("open");
    expect(decideVaultGate({ resolved: true, syncStateCount: 0, remoteCount: null })).toBe("open");
  });

  it("treats a device with sync state as resolved and records it (existing installs)", () => {
    expect(decideVaultGate({ resolved: false, syncStateCount: 1974, remoteCount: 1974 })).toBe(
      "open_and_mark_resolved"
    );
    // even when the hosted count is unknown (offline)
    expect(decideVaultGate({ resolved: false, syncStateCount: 3, remoteCount: null })).toBe(
      "open_and_mark_resolved"
    );
  });

  it("pauses a fresh device when hosted already has notes", () => {
    expect(decideVaultGate({ resolved: false, syncStateCount: 0, remoteCount: 12 })).toBe("paused");
  });

  it("stays open for a first-ever upload (hosted is empty)", () => {
    expect(decideVaultGate({ resolved: false, syncStateCount: 0, remoteCount: 0 })).toBe("open");
  });

  it("stays paused after an interrupted download even though sync state now exists", () => {
    expect(
      decideVaultGate({ resolved: false, syncStateCount: 800, remoteCount: 1974, downloadInterrupted: true })
    ).toBe("paused");
    expect(
      decideVaultGate({ resolved: false, syncStateCount: 800, remoteCount: null, downloadInterrupted: true })
    ).toBe("paused");
  });

  it("opens once an interrupted download has been resolved", () => {
    expect(
      decideVaultGate({ resolved: true, syncStateCount: 1974, remoteCount: 1974, downloadInterrupted: true })
    ).toBe("open");
  });

  it("fails closed when a fresh device can't tell what hosted holds", () => {
    expect(decideVaultGate({ resolved: false, syncStateCount: 0, remoteCount: null })).toBe("paused");
  });
});
