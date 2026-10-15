// src/features/sync/lib/pullFromHostedSync.test.ts
import { describe, it, expect, vi } from "vitest";

// The module imports Tauri-backed stores; only the pure helper is tested here.
vi.mock("@/features/notes/db/client", () => ({ getDb: vi.fn() }));
vi.mock("@/features/sync/db/supabaseClient", () => ({ supabase: {}, isSyncConfigured: false }));
vi.mock("@/features/sync/store/useSyncStore", () => ({ useSyncStore: { getState: () => ({}) } }));
vi.mock("@/features/ui/store/useUIStore", () => ({ useUIStore: { getState: () => ({}) } }));
vi.mock("@/features/notes/store/useNoteStore", () => ({ useNoteStore: { getState: () => ({}) } }));
vi.mock("@/features/ai/store/useAIStore", () => ({ useAIStore: { getState: () => ({}) } }));
vi.mock("@/features/ai/lib/indexer", () => ({ nudgeIndexer: vi.fn() }));
vi.mock("@/features/notes/db/queries", () => ({ updateNote: vi.fn(), syncNoteBlocks: vi.fn() }));
vi.mock("@/features/notes/lib/blockRevisioning", () => ({ writeBlockRevisionSnapshot: vi.fn() }));
vi.mock("@/features/sync/lib/noteSyncState", () => ({
  getSyncState: vi.fn(),
  loadAllSyncStates: vi.fn(),
  recordSynced: vi.fn(),
}));
vi.mock("@/features/sync/lib/pushQueue", () => ({ clearQueued: vi.fn() }));
vi.mock("@/features/sync/lib/remoteNotes", () => ({ fetchRemoteNoteMap: vi.fn() }));

import { selectPullCandidates } from "./pullFromHostedSync";

describe("selectPullCandidates", () => {
  const remote = new Map([
    ["a", { revision: 5 }],
    ["b", { revision: 3 }],
    ["c", { revision: 2 }],
  ]);

  it("picks notes whose hosted revision is past the synced one", () => {
    const states = [
      { noteId: "a", serverRevision: 4 }, // behind
      { noteId: "b", serverRevision: 3 }, // in sync
      { noteId: "c", serverRevision: 3 }, // server below synced: not a pull
    ];
    expect(selectPullCandidates(states, remote)).toEqual(["a"]);
  });

  it("ignores notes missing from the hosted listing", () => {
    expect(selectPullCandidates([{ noteId: "z", serverRevision: 1 }], remote)).toEqual([]);
  });
});