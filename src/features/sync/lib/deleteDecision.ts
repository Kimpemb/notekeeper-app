// src/features/sync/lib/deleteDecision.ts
//
// Stage 4d tombstones, step 2 — pure decision function for the DELETE side of
// sync. Sibling to syncDecision.ts (decideSyncAction), which keeps handling the
// live-versus-live cases. No DB, no network, no async; unit-tested in
// deleteDecision.test.ts. Implements rows A to J of the decision table in
// stage-4d-tombstones-design-rev2.md, plus three defensive rules (see below).
//
// Inputs, per note id:
//   local     present or absent (a row in `notes`)
//   tombstone a row in note_tombstones (pending or conflict), recorded when a
//             note with sync state was permanently deleted
//   hosted    the hosted row: absent, live, trashed (deleted_at set) or purged
//             (purged_at set, content blanked, row kept)
//
// Not handled here: trash and restore propagation (T5). That is the pull
// applying hosted deleted_at when decideSyncAction says "behind", so a live or
// trashed hosted row with a local note present is deferred to decideSyncAction.

export type HostedState = "live" | "trashed" | "purged";

export interface HostedRowInfo {
  state: HostedState;
  revision: number; // server-assigned revision
}

export interface TombstoneInfo {
  state: "pending" | "conflict";
  serverRevision: number; // synced server revision when the note was deleted
}

export interface DeleteInputs {
  localPresent: boolean;
  tombstone: TombstoneInfo | null;
  /** Only read when localPresent: a note_sync_state row exists for the note. */
  hasSyncState: boolean;
  /** Only read when localPresent: revision, updated_at or meta_rev differs from that sync state. */
  localChanged: boolean;
  hosted: HostedRowInfo | null;
}

export type ParkReason =
  | "edited_elsewhere" // deleted here, but the hosted note moved on (row D)
  | "edited_here" // purged elsewhere, but this device changed it (row G)
  | "no_base" // purged elsewhere and no sync state to judge local changes against
  | "server_regressed"; // hosted revision is below the tombstone's (server reset?)

export type ClearReason =
  | "already_purged" // hosted row is already purged (row E)
  | "hosted_missing" // hosted row is gone (row J, anomaly)
  | "local_note_exists"; // a local note with this id exists again, so the tombstone is stale

export type DeleteDecision =
  | { action: "insert_new"; asTrashed: boolean } // new here: create it locally (row A)
  | { action: "noop"; reason: "nothing_to_do" | "already_parked" } // rows B and I
  | { action: "push_purge"; expectedServerRevision: number } // CAS purge on hosted (row C)
  | { action: "park_conflict"; reason: ParkReason } // needs the 4d.3 review; write nothing
  | { action: "clear_tombstone"; reason: ClearReason } // forget the tombstone, no hosted write
  | { action: "apply_purge_local" } // hosted purged, local unchanged: delete locally (row F)
  | { action: "defer_to_sync_decision" }; // live-versus-live: use decideSyncAction

export function decideDeleteAction(input: DeleteInputs): DeleteDecision {
  const { localPresent, tombstone, hasSyncState, localChanged, hosted } = input;

  if (localPresent) {
    // A tombstone for a note that exists again is stale. Never push a purge
    // for a note we still have; clear it and let the next drain re-evaluate.
    if (tombstone) return { action: "clear_tombstone", reason: "local_note_exists" };

    if (!hosted || hosted.state !== "purged") return { action: "defer_to_sync_decision" };

    // Hosted note was purged elsewhere and we still have it.
    if (!hasSyncState) return { action: "park_conflict", reason: "no_base" };
    if (localChanged) return { action: "park_conflict", reason: "edited_here" }; // row G
    return { action: "apply_purge_local" }; // row F
  }

  // Local note is absent.
  if (!tombstone) {
    if (!hosted || hosted.state === "purged") return { action: "noop", reason: "nothing_to_do" }; // row B
    return { action: "insert_new", asTrashed: hosted.state === "trashed" }; // row A
  }

  // Local note is absent and a tombstone exists: this device deleted it.
  if (!hosted) return { action: "clear_tombstone", reason: "hosted_missing" }; // row J
  if (hosted.state === "purged") return { action: "clear_tombstone", reason: "already_purged" }; // row E
  if (tombstone.state === "conflict") return { action: "noop", reason: "already_parked" }; // row I

  if (hosted.revision === tombstone.serverRevision) {
    return { action: "push_purge", expectedServerRevision: tombstone.serverRevision }; // row C
  }
  if (hosted.revision > tombstone.serverRevision) {
    return { action: "park_conflict", reason: "edited_elsewhere" }; // row D
  }
  return { action: "park_conflict", reason: "server_regressed" };
}

const PARK_TEXT: Record<ParkReason, string> = {
  edited_elsewhere: "deleted here but changed on the server",
  edited_here: "deleted on the server but changed on this device",
  no_base: "deleted on the server but no sync base is recorded",
  server_regressed: "server revision is older than the one recorded at delete time",
};

const CLEAR_TEXT: Record<ClearReason, string> = {
  already_purged: "already purged on the server: tombstone no longer needed",
  hosted_missing: "server row is gone: tombstone no longer needed",
  local_note_exists: "note exists locally again: tombstone is stale",
};

export function describeDeleteDecision(d: DeleteDecision): string {
  switch (d.action) {
    case "insert_new":
      return d.asTrashed
        ? "new on the server (in its trash): create locally as trashed"
        : "new on the server: create locally";
    case "noop":
      return d.reason === "already_parked" ? "delete conflict already parked for review" : "nothing to do";
    case "push_purge":
      return "deleted here: purge on the server";
    case "park_conflict":
      return PARK_TEXT[d.reason];
    case "clear_tombstone":
      return CLEAR_TEXT[d.reason];
    case "apply_purge_local":
      return "purged on the server and unchanged here: delete locally";
    case "defer_to_sync_decision":
      return "not a delete case: use the normal sync decision";
  }
}