// src/features/notes/similarity/clusterEngine.ts
//
// Cluster gap engine — identifies the dominant note cluster in the current
// session and scores "gap" candidates (related notes not yet visited).
//
// SESSION RULES
//   - A session resets after 30 minutes of inactivity (no note opened)
//   - Cluster = notes connected by backlinks OR similarity ≥ 2 OR shared ancestor ≤ 3 levels
//   - Trigger = 3+ minutes cumulative time in a cluster OR 3+ notes visited
//   - Only one suggestion per 24 hours (enforced by caller via app_settings)
//
// CANDIDATE SCORING
//   - Backlink neighbour of any cluster note:          5 pts
//   - Similarity score ≥ threshold to cluster note:   3 pts
//   - Unlinked mention of any cluster note title:      2 pts
//   - Shared parent (level 1):                         4 pts
//   - Shared grandparent (level 2):                    3 pts
//   - Shared great-grandparent (level 3):              2 pts
//   - Minimum score to surface:                        4 pts (test: 2)

import type { Note } from "../../../types";
import { getSimilarityResults, type FeedbackEntry } from "./similarityUtils";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface VisitEntry {
  noteId: string;
  enteredAt: number;
  leftAt: number;
}

export interface SessionState {
  visits: VisitEntry[];
  lastActivityAt: number;
}

export interface ClusterGapCandidate {
  noteId: string;
  score: number;
  referringNoteId: string;
  backlinkMatch: boolean;
  similarityMatch: boolean;
  unlinkedMentionMatch: boolean;
  ancestorMatch: boolean;
  ancestorLevel: number | null; // 1 = same parent, 2 = grandparent, 3 = great-grandparent
}

// ─── Constants ────────────────────────────────────────────────────────────────
// TEST VALUES — restore before committing to prod:
//   INACTIVITY_RESET_MS : 30 * 60 * 1000
//   TRIGGER_TIME_MS     : 3 * 60 * 1000
//   TRIGGER_NOTE_COUNT  : 3
//   MIN_CANDIDATE_SCORE : 4
//   SIMILARITY_THRESHOLD: 2

const INACTIVITY_RESET_MS  = 30 * 60 * 1000;
const TRIGGER_TIME_MS      = 3 * 60 * 1000;
const TRIGGER_NOTE_COUNT   = 3;
const MIN_CANDIDATE_SCORE  = 4;
const SIMILARITY_THRESHOLD = 2;            // loose  (prod: 2)
const MAX_ANCESTOR_DEPTH   = 3;              // never group beyond great-grandparent

// ─── Session management ───────────────────────────────────────────────────────

export function createSession(): SessionState {
  return { visits: [], lastActivityAt: Date.now() };
}

export function recordVisit(
  session: SessionState,
  noteId: string,
  now = Date.now()
): SessionState {
  const sinceLastActivity = now - session.lastActivityAt;

  if (sinceLastActivity > INACTIVITY_RESET_MS && session.visits.length > 0) {
    return {
      visits: [{ noteId, enteredAt: now, leftAt: now }],
      lastActivityAt: now,
    };
  }

  const visits = session.visits.map((v, i) =>
    i === session.visits.length - 1 && v.leftAt === v.enteredAt
      ? { ...v, leftAt: now }
      : v
  );

  return {
    visits: [...visits, { noteId, enteredAt: now, leftAt: now }],
    lastActivityAt: now,
  };
}

export function tickSession(session: SessionState, now = Date.now()): SessionState {
  if (session.visits.length === 0) return session;
  const visits = [...session.visits];
  visits[visits.length - 1] = { ...visits[visits.length - 1], leftAt: now };
  return { ...session, lastActivityAt: now, visits };
}

// ─── Ancestor helpers ─────────────────────────────────────────────────────────

/**
 * Returns the ancestor chain for a note, up to MAX_ANCESTOR_DEPTH levels.
 * Index 0 = direct parent, index 1 = grandparent, etc.
 */
function getAncestorChain(noteId: string, noteMap: Map<string, Note>): string[] {
  const ancestors: string[] = [];
  let current = noteMap.get(noteId);
  while (current && current.parent_id && ancestors.length < MAX_ANCESTOR_DEPTH) {
    ancestors.push(current.parent_id);
    current = noteMap.get(current.parent_id);
  }
  return ancestors;
}

/**
 * Returns the shared ancestor level between two notes (1-based),
 * or null if they share no ancestor within MAX_ANCESTOR_DEPTH.
 * Level 1 = same parent, 2 = same grandparent, 3 = same great-grandparent.
 */
function sharedAncestorLevel(
  noteIdA: string,
  noteIdB: string,
  noteMap: Map<string, Note>
): number | null {
  const chainA = getAncestorChain(noteIdA, noteMap);
  const chainB = getAncestorChain(noteIdB, noteMap);

  for (let i = 0; i < chainA.length; i++) {
    for (let j = 0; j < chainB.length; j++) {
      if (chainA[i] === chainB[j]) {
        // Level = the deeper of the two depths + 1 (1-based)
        return Math.max(i, j) + 1;
      }
    }
  }
  return null;
}

/**
 * Points awarded for a shared ancestor at a given level.
 */
function ancestorPoints(level: number): number {
  if (level === 1) return 4; // same parent
  if (level === 2) return 3; // same grandparent
  if (level === 3) return 2; // same great-grandparent
  return 0;
}

// ─── Cluster identification ───────────────────────────────────────────────────

/**
 * Returns the dominant cluster from the current session.
 * Expands via backlinks, similarity ≥ threshold, OR shared ancestor ≤ 3 levels.
 */
export function identifyCluster(
  session: SessionState,
  allNotes: Note[],
  backlinkMap: Map<string, Set<string>>,
  feedback: FeedbackEntry[]
): Set<string> {
  if (session.visits.length === 0) return new Set();

  const timePerNote = new Map<string, number>();
  for (const visit of session.visits) {
    const duration = visit.leftAt - visit.enteredAt;
    timePerNote.set(visit.noteId, (timePerNote.get(visit.noteId) ?? 0) + duration);
  }

  const noteMap = new Map(allNotes.map((n) => [n.id, n]));
  const sorted  = [...timePerNote.entries()].sort((a, b) => b[1] - a[1]);
  if (sorted.length === 0) return new Set();

  const cluster = new Set<string>();
  const queue   = [sorted[0][0]];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (cluster.has(current)) continue;
    cluster.add(current);

    const currentNote = noteMap.get(current);
    if (!currentNote) continue;

    for (const [visitedId] of timePerNote) {
      if (cluster.has(visitedId)) continue;

      // Expand via backlinks
      const linked = backlinkMap.get(current) ?? new Set();
      if (linked.has(visitedId)) { queue.push(visitedId); continue; }

      // Expand via similarity
      const visitedNotes = [...timePerNote.keys()]
        .map((id) => noteMap.get(id))
        .filter(Boolean) as Note[];
      const simResults = getSimilarityResults(currentNote, visitedNotes, feedback, new Set(), 10);
      const simScore   = simResults.find((r) => r.noteId === visitedId)?.score ?? 0;
      if (simScore >= SIMILARITY_THRESHOLD) { queue.push(visitedId); continue; }

      // Expand via shared ancestor ≤ 3 levels
      const level = sharedAncestorLevel(current, visitedId, noteMap);
      if (level !== null) { queue.push(visitedId); }
    }
  }

  return cluster;
}

// ─── Trigger check ────────────────────────────────────────────────────────────

export function shouldTrigger(session: SessionState, cluster: Set<string>): boolean {
  if (cluster.size === 0) return false;

  const visitedInCluster = new Set(
    session.visits.map((v) => v.noteId).filter((id) => cluster.has(id))
  );
  if (visitedInCluster.size >= TRIGGER_NOTE_COUNT) return true;

  let totalTime = 0;
  for (const visit of session.visits) {
    if (cluster.has(visit.noteId)) totalTime += visit.leftAt - visit.enteredAt;
  }
  return totalTime >= TRIGGER_TIME_MS;
}

// ─── Candidate scoring ────────────────────────────────────────────────────────

export function scoreGapCandidates(
  cluster: Set<string>,
  session: SessionState,
  allNotes: Note[],
  backlinkMap: Map<string, Set<string>>,
  feedback: FeedbackEntry[],
  dismissedPairs: Set<string>,
  unlinkedMentionMap: Map<string, Set<string>>
): ClusterGapCandidate[] {
  const visitedThisSession = new Set(session.visits.map((v) => v.noteId));
  const noteMap            = new Map(allNotes.map((n) => [n.id, n]));
  const clusterNotes       = [...cluster].map((id) => noteMap.get(id)).filter(Boolean) as Note[];
  const candidateScores    = new Map<string, ClusterGapCandidate>();

  for (const clusterNote of clusterNotes) {
    const simResults = getSimilarityResults(clusterNote, allNotes, feedback, cluster, 20);

    // Build candidate pool: backlink neighbours + similarity neighbours + ancestor neighbours
    const neighbours = new Set<string>();

    for (const id of (backlinkMap.get(clusterNote.id) ?? new Set())) {
      if (!cluster.has(id) && !visitedThisSession.has(id)) neighbours.add(id);
    }
    for (const result of simResults) {
      if (result.score >= SIMILARITY_THRESHOLD && !visitedThisSession.has(result.noteId)) {
        neighbours.add(result.noteId);
      }
    }
    // Ancestor neighbours — any note sharing an ancestor ≤ 3 levels with this cluster note
    for (const note of allNotes) {
      if (cluster.has(note.id) || visitedThisSession.has(note.id)) continue;
      const level = sharedAncestorLevel(clusterNote.id, note.id, noteMap);
      if (level !== null) neighbours.add(note.id);
    }

    for (const candidateId of neighbours) {
      const candidateNote = noteMap.get(candidateId);
        if (!candidateNote || candidateNote.deleted_at) continue;

// Skip notes with no content AND no subpages — nothing useful to surface
const hasContent  = candidateNote.plaintext && candidateNote.plaintext.trim().length > 0;
const hasSubpages = allNotes.some((n) => n.parent_id === candidateNote.id && !n.deleted_at);
if (!hasContent && !hasSubpages) continue;      

      const pairKey1 = `${clusterNote.id}:${candidateId}`;
      const pairKey2 = `${candidateId}:${clusterNote.id}`;
      if (dismissedPairs.has(pairKey1) || dismissedPairs.has(pairKey2)) continue;

      let score                = 0;
      let backlinkMatch        = false;
      let similarityMatch      = false;
      let unlinkedMentionMatch = false;
      let ancestorMatch        = false;
      let bestAncestorLevel: number | null = null;

      // Backlink: 5 pts
      if ((backlinkMap.get(clusterNote.id) ?? new Set()).has(candidateId)) {
        score += 5; backlinkMatch = true;
      }

      // Similarity: 3 pts
      const simScore = simResults.find((r) => r.noteId === candidateId)?.score ?? 0;
      if (simScore >= SIMILARITY_THRESHOLD) {
        score += 3; similarityMatch = true;
      }

      // Unlinked mention: 2 pts
      const mentionedBy     = unlinkedMentionMap.get(candidateId) ?? new Set();
      const clusterMentions = [...cluster].some((id) => mentionedBy.has(id));
      if (clusterMentions) {
        score += 2; unlinkedMentionMatch = true;
      }

      // Ancestor proximity: 4/3/2 pts depending on level
      const level = sharedAncestorLevel(clusterNote.id, candidateId, noteMap);
      if (level !== null) {
        const pts = ancestorPoints(level);
        score += pts;
        ancestorMatch     = true;
        bestAncestorLevel = level;
      }

      if (score < MIN_CANDIDATE_SCORE) continue;

      const existing = candidateScores.get(candidateId);
      if (!existing || score > existing.score) {
        candidateScores.set(candidateId, {
          noteId: candidateId,
          score,
          referringNoteId: clusterNote.id,
          backlinkMatch,
          similarityMatch,
          unlinkedMentionMatch,
          ancestorMatch,
          ancestorLevel: bestAncestorLevel,
        });
      }
    }
  }

  return [...candidateScores.values()].sort((a, b) => b.score - a.score);
}

// ─── Map builders ─────────────────────────────────────────────────────────────

export function buildBacklinkMap(
  backlinks: { source_id: string; target_id: string }[]
): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  const add = (a: string, b: string) => {
    if (!map.has(a)) map.set(a, new Set());
    map.get(a)!.add(b);
  };
  for (const { source_id, target_id } of backlinks) {
    add(source_id, target_id);
    add(target_id, source_id);
  }
  return map;
}

export function buildUnlinkedMentionMap(allNotes: Note[]): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const target of allNotes) {
    if (!target.title || /^Untitled-\d+$/.test(target.title)) continue;
    const escaped = target.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex   = new RegExp(`(?<![\\w])${escaped}(?![\\w])`, "gi");
    for (const source of allNotes) {
      if (source.id === target.id) continue;
      if ((source.plaintext ?? "").match(regex)) {
        if (!map.has(target.id)) map.set(target.id, new Set());
        map.get(target.id)!.add(source.id);
      }
    }
  }
  return map;
}

export function isNewCluster(previousCluster: string[], currentCluster: Set<string>): boolean {
  if (previousCluster.length === 0) return true;
  const overlap = previousCluster.filter((id) => currentCluster.has(id)).length;
  return overlap / previousCluster.length < 0.5;
}