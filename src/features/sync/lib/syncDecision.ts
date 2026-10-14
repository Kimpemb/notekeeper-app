// src/features/sync/lib/syncDecision.ts
//
// Stage 4d.1 — pure decision function: given a note's local state, its recorded
// sync state (the last point both sides agreed on) and the hosted row, decide
// what to do. No DB, no network, no async — unit-tested in syncDecision.test.ts.
//
// Revision numbers are per-device and not comparable across devices, so
// everything is judged against the sync state:
//   local counter   vs. the local revision at the last agreement
//   server counter  vs. the server revision at the last agreement
//
// "Local changed" = local revision OR updated_at differs from the sync state.
// updated_at is included because title / parent / sort-order edits don't bump
// the content-driven revision.

export interface LocalNoteInfo {
  revision: number;
  updatedAt: number; // ms
}

export interface SyncStateInfo {
  localRevision: number;
  localUpdatedAt: number; // ms, local updated_at at the last agreement
  serverRevision: number;
}

export interface RemoteNoteInfo {
  revision: number; // server-assigned revision
  updatedAt: number; // ms
}

export type DivergedReason =
  | "both_changed"      // local and server both moved since the last agreement
  | "no_base"           // server copy exists, but no recorded sync state to compare against
  | "local_regressed"   // local revision is below the last synced one (restored backup?)
  | "server_regressed"; // server revision is below the last synced one (server reset?)

export type SyncDecision =
  | { action: "insert" }                                    // not on the server yet
  | { action: "in_sync" }                                   // nothing to do
  | { action: "adopt" }                                     // identical on both sides, just record the state
  | { action: "push"; expectedServerRevision: number }      // local changed only → compare-and-swap push
  | { action: "behind" }                                    // server changed only → pull (fast-forward)
  | { action: "diverged"; reason: DivergedReason };         // needs the three-way reconcile

export function decideSyncAction(
  local: LocalNoteInfo,
  state: SyncStateInfo | null,
  remote: RemoteNoteInfo | null
): SyncDecision {
  if (!remote) return { action: "insert" };

  if (!state) {
    // Unseeded note that already exists on the server. Before 4d.1 only this
    // device ever pushed, so identical stamps mean identical content, and a
    // local copy that's ahead of (or newer than) the server copy is a
    // local-only change that failed or was made offline.
    if (remote.revision === local.revision && remote.updatedAt === local.updatedAt) {
      return { action: "adopt" };
    }
    const localAhead =
      remote.revision < local.revision ||
      (remote.revision === local.revision && local.updatedAt > remote.updatedAt);
    if (localAhead) return { action: "push", expectedServerRevision: remote.revision };
    return { action: "diverged", reason: "no_base" };
  }

  if (local.revision < state.localRevision) {
    return { action: "diverged", reason: "local_regressed" };
  }
  if (remote.revision < state.serverRevision) {
    return { action: "diverged", reason: "server_regressed" };
  }

  const localChanged =
    local.revision !== state.localRevision || local.updatedAt !== state.localUpdatedAt;

  if (remote.revision === state.serverRevision) {
    return localChanged
      ? { action: "push", expectedServerRevision: state.serverRevision }
      : { action: "in_sync" };
  }

  // remote.revision > state.serverRevision
  return localChanged ? { action: "diverged", reason: "both_changed" } : { action: "behind" };
}

export function describeDecision(d: SyncDecision): string {
  if (d.action === "behind") return "server has newer changes (pull needed)";
  if (d.action === "diverged") {
    switch (d.reason) {
      case "both_changed":
        return "changed on both this device and the server";
      case "no_base":
        return "server copy exists but no sync base is recorded";
      case "local_regressed":
        return "local revision is older than the last synced one";
      case "server_regressed":
        return "server revision is older than the last synced one";
    }
  }
  return d.action;
}
