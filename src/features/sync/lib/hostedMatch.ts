// src/features/sync/lib/hostedMatch.ts
//
// Step 14b follow-up (heal for a lost push answer). PURE: no DB, no network, no
// supabaseClient import, so it runs in the node test environment.
//
// Situation it exists for: a push wins the compare-and-swap on the server but the
// answer is lost (timeout, dropped connection). The retry then sees hosted one revision
// ahead of the recorded sync state and local "changed", and decideSyncAction says
// "diverged / both_changed" even though hosted already holds exactly what this device
// pushed. healVerdict says whether the hosted row is provably identical to the local
// one. Conservative on purpose: any doubt means "do not heal" and the note is parked
// for review exactly as before.

import type { DivergedReason } from "./syncDecision";

/** The local fields a push writes (see toRemoteFields in pushToHostedSync.ts). */
export interface LocalCompare {
  title: string;
  content: string;
  plaintext: string;
  tags: string | null;
  parent_id: string | null;
  sort_order: number;
  frontmatter: string | null;
  updated_at: number; // ms
  deleted_at: number | null; // ms
}

/** The hosted row as read back. Columns that may come back as text OR parsed JSON are `unknown`. */
export interface HostedCompare {
  revision: number;
  title: string;
  content: unknown;
  plaintext: string;
  tags: unknown;
  parent_id: string | null;
  sort_order: unknown;
  frontmatter: unknown;
  updated_at: string;
  deleted_at: string | null;
  purged_at: string | null;
}

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return Object.fromEntries(Object.keys(o).sort().map((k) => [k, sortKeys(o[k])]));
  }
  return v;
}

/** Canonical text of a JSON-ish column: key order and whitespace do not matter. */
function jsonText(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "string") {
    try {
      return JSON.stringify(sortKeys(JSON.parse(v)));
    } catch {
      return v; // not JSON: only an exact string match counts
    }
  }
  return JSON.stringify(sortKeys(v));
}

function toNumber(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.trim() !== "") return Number(v);
  return Number.NaN;
}

function sameInstant(ms: number | null, iso: string | null): boolean {
  if (ms === null || iso === null) return ms === null && iso === null;
  const parsed = Date.parse(iso);
  return Number.isFinite(parsed) && parsed === ms;
}

/** Names of the fields that differ. Empty = identical. */
export function compareWithHosted(local: LocalCompare, hosted: HostedCompare): string[] {
  const differing: string[] = [];
  if (hosted.purged_at !== null) differing.push("purged_at");
  if (local.title !== hosted.title) differing.push("title");
  if (jsonText(local.content) !== jsonText(hosted.content)) differing.push("content");
  if (local.plaintext !== hosted.plaintext) differing.push("plaintext");
  if (jsonText(local.tags) !== jsonText(hosted.tags)) differing.push("tags");
  if (local.parent_id !== hosted.parent_id) differing.push("parent_id");
  if (local.sort_order !== toNumber(hosted.sort_order)) differing.push("sort_order");
  if (jsonText(local.frontmatter) !== jsonText(hosted.frontmatter)) differing.push("frontmatter");
  if (!sameInstant(local.updated_at, hosted.updated_at)) differing.push("updated_at");
  if (!sameInstant(local.deleted_at, hosted.deleted_at)) differing.push("deleted_at");
  return differing;
}

export type HealVerdict = { heal: true } | { heal: false; why: string };

const HEALABLE: readonly DivergedReason[] = ["both_changed", "no_base"];

/**
 * @param reason               why decideSyncAction said "diverged"
 * @param remoteRevisionAtDecision  the hosted revision that decision was made on
 * @param hosted               the hosted row read just now
 * @param local                the local row the decision was made on
 *
 * local_regressed and server_regressed are never healed: they point at a restored
 * backup or a reset server, where "identical" would prove nothing about history.
 */
export function healVerdict(
  reason: DivergedReason,
  remoteRevisionAtDecision: number,
  hosted: HostedCompare,
  local: LocalCompare
): HealVerdict {
  if (!HEALABLE.includes(reason)) return { heal: false, why: `reason ${reason} is never healed` };
  if (hosted.revision !== remoteRevisionAtDecision) {
    return { heal: false, why: `hosted moved (r${remoteRevisionAtDecision} -> r${hosted.revision})` };
  }
  const differing = compareWithHosted(local, hosted);
  if (differing.length > 0) return { heal: false, why: `differs: ${differing.join(",")}` };
  return { heal: true };
}
