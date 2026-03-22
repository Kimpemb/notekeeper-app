// src/features/notes/similarity/similarityUtils.ts
//
// Pure text-based similarity scoring — no AI.
// Called by getSimilarNotes() in queries.ts; never touches the DB directly.

import type { Note } from "../../../types";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SimilarityResult {
  noteId: string;
  score: number;
  confidence: "Strong" | "Possible";
  sharedTags: string[];
  sharedKeywords: string[];
}

/** One row from suggestion_feedback, passed in from queries.ts */
export interface FeedbackEntry {
  source_id: string;
  target_id: string;
  action: "accepted" | "ignored";
}

// ─── Stop Words ───────────────────────────────────────────────────────────────

const STOP_WORDS = new Set([
  "the", "and", "for", "are", "but", "not", "you", "all", "can", "her",
  "was", "one", "our", "out", "day", "get", "has", "him", "his", "how",
  "its", "may", "new", "now", "old", "see", "two", "who", "boy", "did",
  "use", "way", "she", "many", "then", "them", "this", "from", "they",
  "will", "with", "have", "been", "more", "that", "what", "when", "your",
  "said", "each", "which", "their", "time", "about", "would", "there",
  "could", "other", "into", "than", "also", "just", "like", "some",
]);

// ─── Keyword Extraction ───────────────────────────────────────────────────────

export function extractKeywords(title: string): string[] {
  return title
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((w) => w.length >= 3 && !STOP_WORDS.has(w));
}

// ─── Tag Frequency Decay ─────────────────────────────────────────────────────

function tagDecayMultiplier(tagNoteCount: number, totalNotes: number): number {
  const ratio = tagNoteCount / totalNotes;
  if (ratio > 0.4) return 0.1;
  if (ratio > 0.2) return 0.3;
  return 1.0;
}

// ─── Tag Frequency Index ─────────────────────────────────────────────────────

export function buildTagFrequencyIndex(notes: Note[]): Map<string, number> {
  const index = new Map<string, number>();
  for (const note of notes) {
    for (const tag of note.tags ?? []) {
      index.set(tag, (index.get(tag) ?? 0) + 1);
    }
  }
  return index;
}

// ─── Feedback Lookup ─────────────────────────────────────────────────────────

export function buildFeedbackMap(
  feedback: FeedbackEntry[]
): Map<string, Map<string, "accepted" | "ignored">> {
  const map = new Map<string, Map<string, "accepted" | "ignored">>();

  const set = (a: string, b: string, action: "accepted" | "ignored") => {
    if (!map.has(a)) map.set(a, new Map());
    map.get(a)!.set(b, action);
  };

  for (const { source_id, target_id, action } of feedback) {
    set(source_id, target_id, action);
    set(target_id, source_id, action);
  }

  return map;
}

// ─── Core Scorer ─────────────────────────────────────────────────────────────

/**
 * Scores a single candidate note against the source note.
 *
 * Exclusions (returns null):
 *   - Same note as source
 *   - Already linked via backlink
 *   - Previously ignored → excluded permanently
 *   - Previously accepted → excluded (link already exists or was intentional;
 *     no point re-surfacing it in the panel)
 *
 * Scoring:
 *   Shared tag     → 3 pts × decay multiplier
 *   Shared keyword → 1 pt
 *   Recency boost  → ×1.3 if candidate updated within last 7 days
 *
 * Confidence:
 *   score ≥ 6 → "Strong"
 *   score ≥ 2 → "Possible"
 *   score < 2 → excluded
 */
export function scoreCandidate(
  sourceNote: Note,
  candidate: Note,
  tagFrequency: Map<string, number>,
  totalNotes: number,
  feedbackMap: Map<string, Map<string, "accepted" | "ignored">>,
  backlinkIds: Set<string>
): SimilarityResult | null {
  if (candidate.id === sourceNote.id) return null;
  if (backlinkIds.has(candidate.id)) return null;

  // Exclude both ignored AND accepted pairs — accepted means the link was
  // already created; no need to keep suggesting it.
  const pairFeedback = feedbackMap.get(sourceNote.id)?.get(candidate.id);
  if (pairFeedback === "ignored" || pairFeedback === "accepted") return null;

  const sourceTags     = new Set(sourceNote.tags ?? []);
  const candidateTags  = new Set(candidate.tags ?? []);
  const sourceKws      = new Set(extractKeywords(sourceNote.title));
  const candidateKws   = new Set(extractKeywords(candidate.title));

  // ── Tag score ─────────────────────────────────────────────────────────────
  const sharedTags: string[] = [];
  let tagScore = 0;

  for (const tag of sourceTags) {
    if (candidateTags.has(tag)) {
      sharedTags.push(tag);
      const freq = tagFrequency.get(tag) ?? 1;
      tagScore += 3 * tagDecayMultiplier(freq, totalNotes);
    }
  }

  // ── Keyword score ─────────────────────────────────────────────────────────
  const sharedKeywords: string[] = [];
  let keywordScore = 0;

  for (const kw of sourceKws) {
    if (candidateKws.has(kw)) {
      sharedKeywords.push(kw);
      keywordScore += 1;
    }
  }

  let score = tagScore + keywordScore;

  // ── Recency boost ─────────────────────────────────────────────────────────
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  if ((candidate.updated_at ?? 0) >= sevenDaysAgo) {
    score *= 1.3;
  }

  // ── Confidence gate ───────────────────────────────────────────────────────
  if (score < 2) return null;

  const confidence: "Strong" | "Possible" = score >= 6 ? "Strong" : "Possible";

  return { noteId: candidate.id, score, confidence, sharedTags, sharedKeywords };
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function getSimilarityResults(
  sourceNote: Note,
  allNotes: Note[],
  feedback: FeedbackEntry[],
  backlinkIds: Set<string>,
  limit = 5
): SimilarityResult[] {
  const tagFrequency = buildTagFrequencyIndex(allNotes);
  const feedbackMap  = buildFeedbackMap(feedback);
  const totalNotes   = allNotes.length;

  const results: SimilarityResult[] = [];

  for (const candidate of allNotes) {
    const result = scoreCandidate(
      sourceNote, candidate, tagFrequency, totalNotes, feedbackMap, backlinkIds
    );
    if (result) results.push(result);
  }

  return results.sort((a, b) => b.score - a.score).slice(0, limit);
}