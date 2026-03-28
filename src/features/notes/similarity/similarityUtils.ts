// src/features/notes/similarity/similarityUtils.ts
//
// Text-based similarity scoring + AI fallback for weak matches.
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

export interface AISmiliarityResult {
  noteId: string;
  title: string;
  reason: string; // short explanation from Gemini
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function extractKeywords(title: string): string[] {
  return title
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((w) => w.length >= 3 && !STOP_WORDS.has(w));
}

function parseTags(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
    return [];
  } catch {
    return [];
  }
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
    for (const tag of parseTags(note.tags)) {
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

  const pairFeedback = feedbackMap.get(sourceNote.id)?.get(candidate.id);
  if (pairFeedback === "ignored" || pairFeedback === "accepted") return null;

  const sourceTags    = new Set(parseTags(sourceNote.tags));
  const candidateTags = new Set(parseTags(candidate.tags));
  const sourceKws     = new Set(extractKeywords(sourceNote.title));
  const candidateKws  = new Set(extractKeywords(candidate.title));

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
  if ((candidate.updated_at ?? 0) >= sevenDaysAgo) score *= 1.3;

  // ── Confidence gate ───────────────────────────────────────────────────────
  if (score < 2) return null;

  const confidence: "Strong" | "Possible" = score >= 6 ? "Strong" : "Possible";
  return { noteId: candidate.id, score, confidence, sharedTags, sharedKeywords };
}

// ─── Public API — algorithmic ─────────────────────────────────────────────────

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

// ─── Public API — AI fallback ─────────────────────────────────────────────────

/**
 * Called when algorithmic results are weak (fewer than 2 results).
 * Sends note title + plaintext + candidate titles to Gemini and asks
 * which notes are semantically related.
 * Returns up to 3 AI-suggested notes with a short reason each.
 */
export async function getAISimilarNotes(
  sourceNote: Note,
  allNotes: Note[],
  existingResultIds: Set<string>
): Promise<AISmiliarityResult[]> {
  // Only consider notes not already surfaced by the algorithm
  const candidates = allNotes
    .filter((n) => n.id !== sourceNote.id && !existingResultIds.has(n.id))
    .slice(0, 40); // cap candidates to keep prompt lean

  if (candidates.length === 0) return [];

  const candidateList = candidates
    .map((n, i) => `${i + 1}. [${n.id}] ${n.title}`)
    .join("\n");

  const prompt = `You are a helpful assistant finding semantically related notes in a personal knowledge base.

Source note:
Title: ${sourceNote.title}
Content: ${(sourceNote.plaintext ?? "").slice(0, 1500)}

Candidate notes:
${candidateList}

Which of these candidates are meaningfully related to the source note? Rules:
- Return at most 3 candidates
- Only include genuinely related notes — not just similar words
- Format each result on its own line exactly like this:
[NOTE_ID] | reason why it's related (one sentence)
- Return ONLY the results, no intro, no preamble
- If none are related, return: NONE`;

  try {
    const { callGemini } = await import("../../../features/ai/lib/client");
    const raw = await callGemini(prompt);

    if (raw.trim() === "NONE") return [];

    return raw
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("["))
      .map((line) => {
        const match = line.match(/^\[([^\]]+)\]\s*\|\s*(.+)$/);
        if (!match) return null;
        const [, noteId, reason] = match;
        const note = candidates.find((n) => n.id === noteId);
        if (!note) return null;
        return { noteId, title: note.title, reason: reason.trim() };
      })
      .filter((r): r is AISmiliarityResult => r !== null)
      .slice(0, 3);
  } catch {
    return []; // silently fail — AI suggestions are additive, not critical
  }
}