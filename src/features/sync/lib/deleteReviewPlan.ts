// src/features/sync/lib/deleteReviewPlan.ts
//
// Stage 4d.3, step 10 — the PURE half of the two delete reviews. No DB, no
// network, no store, and no import that reaches supabaseClient (the type import
// is erased at runtime), so it is unit-tested in node.
//
//   D1  "deleted here, edited elsewhere": this device permanently deleted the
//       note (a tombstone, state 'conflict'), but the hosted note moved on.
//         keep_it        restore the hosted version here, clear the tombstone;
//                        nothing is written hosted
//         delete_anyway  back up the hosted content, purge at the CURRENT hosted
//                        revision (not the tombstone's), clear the tombstone
//
//   D2  "purged elsewhere, edited here": the hosted note was purged (content
//       wiped for good) but this device changed its copy.
//         keep_mine      un-purge hosted with a compare-and-swap on the purged
//                        row (no hosted migration needed), then record sync state
//         let_go         back up mine, delete the local note
//
// Defaults (design, Q3 / Q4): D1 keep_it, D2 keep_mine. A purge destroys publish
// and share state; an un-purge does not bring it back, so those are never sent.
//
// Not here: the lock, the backup write, the compare-and-swap, recording sync
// state. Those are commitDelete.ts, with injected collaborators.

import type { BackupInput } from "@/features/sync/lib/reconcileStore";
import { DOWNLOAD_LOCAL_META_REV, DOWNLOAD_LOCAL_REVISION } from "@/features/sync/lib/downloadRow";

// ─── Shared ───────────────────────────────────────────────────────────────

export type D1Choice = "keep_it" | "delete_anyway";
export type D2Choice = "keep_mine" | "let_go";

export type DeleteResult<P, R extends string> =
  | { ok: true; plan: P }
  | { ok: false; reason: R; detail: string[] };

const iso = (ms: number): string => new Date(ms).toISOString();
const failure = <R extends string>(reason: R, detail: string[] = []) => ({ ok: false as const, reason, detail });

/** A hosted row that is live or in the hosted trash (timestamps are ISO strings). */
export interface HostedLiveRow {
  kind: "row";
  revision: number;
  title: string;
  content: string;
  plaintext: string;
  tags: string | null;
  parent_id: string | null;
  sort_order: number | null;
  frontmatter: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

// ─── D1: deleted here, edited elsewhere ───────────────────────────────────

export type D1Hosted = HostedLiveRow | { kind: "purged"; revision: number } | { kind: "missing" };

export interface D1Input {
  choice: D1Choice;
  tombstone: { state: "pending" | "conflict"; serverRevision: number };
  /** true when a local note with this id exists again (the tombstone is stale). */
  localPresent: boolean;
  hosted: D1Hosted;
  /** true when the hosted parent is null or exists on this device. */
  parentExistsLocally: boolean;
}

/** The local insert for keep_it. Same shape and starting counters as the pull's insert. */
export interface D1Insert {
  noteId: string;
  title: string;
  content: string;
  plaintext: string;
  tags: string | null;
  frontmatter: string | null;
  parentId: string | null;
  sortOrder: number;
  createdAt: number; // ms
  updatedAt: number; // ms, equal to the hosted updated_at
  deletedAt: number | null; // ms; a hosted-trashed note arrives trashed
}

export interface D1Plan {
  choice: D1Choice;
  /** Written before any change; null for keep_it (nothing is destroyed). */
  backup: BackupInput | null;
  /** keep_it: the local insert. */
  insert: D1Insert | null;
  /** keep_it: the sync state to record after the insert. */
  syncedAfter: { localRevision: number; metaRev: number; localUpdatedAt: number; serverRevision: number } | null;
  /** delete_anyway: the compare-and-swap value for purge_note (the current hosted revision). */
  purgeExpectedRevision: number | null;
  /** Both choices end the conflict, so the tombstone goes. */
  clearTombstone: true;
  notes: string[];
}

export type D1Failure =
  | "local_note_exists" // stale tombstone: the normal drain clears it
  | "not_parked" // the tombstone is not in conflict state
  | "hosted_missing"
  | "hosted_purged" // already purged: the drain clears the tombstone, nothing to review
  | "not_edited_elsewhere"; // hosted has not moved past the tombstone: the drain purges it normally

export function planD1(noteId: string, input: D1Input): DeleteResult<D1Plan, D1Failure> {
  const { choice, tombstone, hosted } = input;
  const notes: string[] = [];

  if (input.localPresent) return failure("local_note_exists");
  if (tombstone.state !== "conflict") return failure("not_parked");
  if (hosted.kind === "missing") return failure("hosted_missing");
  if (hosted.kind === "purged") return failure("hosted_purged");
  if (hosted.revision <= tombstone.serverRevision) {
    return failure("not_edited_elsewhere", [`hosted ${hosted.revision}, tombstone ${tombstone.serverRevision}`]);
  }

  if (choice === "delete_anyway") {
    return {
      ok: true,
      plan: {
        choice,
        backup: {
          noteId,
          kind: "purge",
          hostedRevision: hosted.revision,
          mineTitle: null,
          mineContent: null,
          theirsTitle: hosted.title,
          theirsContent: hosted.content,
        },
        insert: null,
        syncedAfter: null,
        purgeExpectedRevision: hosted.revision,
        clearTombstone: true,
        notes,
      },
    };
  }

  // keep_it
  let parentId = hosted.parent_id;
  if (parentId !== null && !input.parentExistsLocally) {
    parentId = null; // never reference a parent this device does not have
    notes.push("the hosted parent does not exist here, so the note is restored at the top level");
  }
  const updatedAt = Date.parse(hosted.updated_at);
  return {
    ok: true,
    plan: {
      choice,
      backup: null,
      insert: {
        noteId,
        title: hosted.title,
        content: hosted.content,
        plaintext: hosted.plaintext,
        tags: hosted.tags,
        frontmatter: hosted.frontmatter,
        parentId,
        sortOrder: hosted.sort_order ?? 0,
        createdAt: Date.parse(hosted.created_at),
        updatedAt,
        deletedAt: hosted.deleted_at === null ? null : Date.parse(hosted.deleted_at),
      },
      syncedAfter: {
        localRevision: DOWNLOAD_LOCAL_REVISION,
        metaRev: DOWNLOAD_LOCAL_META_REV,
        localUpdatedAt: updatedAt,
        serverRevision: hosted.revision,
      },
      purgeExpectedRevision: null,
      clearTombstone: true,
      notes,
    },
  };
}

// ─── D2: purged elsewhere, edited here ────────────────────────────────────

export type D2Hosted = { kind: "purged"; revision: number } | { kind: "row"; revision: number } | { kind: "missing" };

export interface D2Local {
  title: string;
  content: string;
  plaintext: string;
  tags: string | null;
  parent_id: string | null;
  sort_order: number;
  frontmatter: string | null;
  deleted_at: number | null; // ms
  updated_at: number; // ms
  revision: number;
  meta_rev: number;
}

export interface D2Input {
  choice: D2Choice;
  local: D2Local;
  hosted: D2Hosted;
  now: number;
}

/** Hosted columns an un-purge writes. Never created_at, publish or fork fields. */
export interface D2ServerFields {
  purged_at: null;
  title: string;
  content: string;
  plaintext: string;
  tags: string | null;
  parent_id: string | null;
  sort_order: number;
  frontmatter: string | null;
  deleted_at: string | null; // ISO
  updated_at: string; // ISO
}

export interface D2Plan {
  choice: D2Choice;
  /** Always written first: mine is the only copy left once hosted is purged. */
  backup: BackupInput;
  /** keep_mine: the un-purge write; null for let_go. */
  serverFields: D2ServerFields | null;
  /** The compare-and-swap value: the purged row's revision. */
  expectedPurgedRevision: number;
  /** keep_mine: the hosted revision after the un-purge (purged revision + 1). */
  serverRevisionAfter: number | null;
  /** keep_mine: the time the server gets; it never goes backwards. This device keeps its own. */
  newUpdatedAt: number | null;
  /** keep_mine: hosted parent_id is a foreign key, so the committer ensures this chain exists first. */
  ensureAncestorsOf: string | null;
  /** let_go: delete the local note (the tombstone trigger records it). */
  deleteLocal: boolean;
  /** The local stamp the committer must find unchanged. */
  expectedLocalStamp: { revision: number; metaRev: number; updatedAt: number };
  notes: string[];
}

export type D2Failure =
  | "hosted_missing"
  | "hosted_not_purged"; // a live hosted row: the normal sync decision applies

export function planD2(noteId: string, input: D2Input): DeleteResult<D2Plan, D2Failure> {
  const { choice, local, hosted } = input;

  if (hosted.kind === "missing") return failure("hosted_missing");
  if (hosted.kind === "row") return failure("hosted_not_purged");

  const backup: BackupInput = {
    noteId,
    kind: "purge",
    hostedRevision: hosted.revision,
    mineTitle: local.title,
    mineContent: local.content,
    theirsTitle: null,
    theirsContent: null,
  };
  const expectedLocalStamp = { revision: local.revision, metaRev: local.meta_rev, updatedAt: local.updated_at };

  if (choice === "let_go") {
    return {
      ok: true,
      plan: {
        choice,
        backup,
        serverFields: null,
        expectedPurgedRevision: hosted.revision,
        serverRevisionAfter: null,
        newUpdatedAt: null,
        ensureAncestorsOf: null,
        deleteLocal: true,
        expectedLocalStamp,
        notes: [],
      },
    };
  }

  // keep_mine
  const newUpdatedAt = Math.max(input.now, local.updated_at + 1);
  return {
    ok: true,
    plan: {
      choice,
      backup,
      serverFields: {
        purged_at: null,
        title: local.title,
        content: local.content,
        plaintext: local.plaintext,
        tags: local.tags,
        parent_id: local.parent_id,
        sort_order: local.sort_order,
        frontmatter: local.frontmatter,
        deleted_at: local.deleted_at === null ? null : iso(local.deleted_at),
        updated_at: iso(newUpdatedAt),
      },
      expectedPurgedRevision: hosted.revision,
      serverRevisionAfter: hosted.revision + 1,
      newUpdatedAt,
      ensureAncestorsOf: local.parent_id,
      deleteLocal: false,
      expectedLocalStamp,
      notes: ["publish and share state were destroyed by the purge and are not restored"],
    },
  };
}
