// src/features/ai/lib/actions.ts
//
// The 3 core AI actions for Tier 1. Each takes a Note and returns a result.
// All calls go through callGemini() — no direct fetch calls here.

import { callGemini } from "@/features/ai/lib/client";
import type { Note } from "@/types";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Build a clean text representation of a note for the AI prompt.
 * Uses plaintext if available, falls back to stripping the title.
 */
function buildNoteText(note: Note): string {
  const body = note.plaintext?.trim() || "";
  return `Title: ${note.title}\n\n${body}`.slice(0, 8000); // keep prompts reasonable
}

// ─── Summarize ────────────────────────────────────────────────────────────────

export interface SummarizeResult {
  summary: string;
}

/**
 * Generate a concise summary of the note (3–5 sentences).
 */
export async function summarizeNote(note: Note): Promise<SummarizeResult> {
  const noteText = buildNoteText(note);

  const prompt = `You are a helpful assistant that summarizes notes clearly and concisely.

Summarize the following note as exactly 4 bullet points. Rules:
- Each bullet MUST be on its own line
- Format exactly like this, one per line:
- First key point here
- Second key point here
- Third key point here
- Fourth key point here
- One sentence per bullet maximum
- Return ONLY the bullets, no intro, no preamble


Note:
${noteText}

Summary:`;

  const summary = await callGemini(prompt);
  return { summary };
}

// ─── Generate Tags ────────────────────────────────────────────────────────────

export interface GenerateTagsResult {
  tags: string[];
}

/**
 * Generate 3–6 relevant tags for the note.
 * Returns tags as a clean string array (no # prefix).
 */
export async function generateTags(note: Note): Promise<GenerateTagsResult> {
  const noteText = buildNoteText(note);

  const prompt = `You are a helpful assistant that generates concise, relevant tags for notes.

Generate 2 to 3 tags for the following note. Rules:
- Lowercase only
- Single words or short hyphenated phrases (e.g. "project-planning")
- No # prefix
- Return ONLY a comma-separated list, nothing else. No explanation, no preamble.

Example output: meeting, action-items, q4-planning, product

Note:
${noteText}

Tags:`;

  const raw = await callGemini(prompt);

  // Parse the comma-separated response into a clean array
  const tags = raw
    .split(",")
    .map((t) => t.trim().toLowerCase().replace(/^#+/, "").replace(/\s+/g, "-"))
    .filter((t) => t.length > 0 && t.length < 40)
    .slice(0, 3);

  return { tags };
}

// ─── Explain ──────────────────────────────────────────────────────────────────

export interface ExplainResult {
  explanation: string;
}

/**
 * Explain what this note is about in plain language —
 * useful for notes that are dense, shorthand, or jargon-heavy.
 */
export async function explainNote(note: Note): Promise<ExplainResult> {
  const noteText = buildNoteText(note);

  const prompt = `You are a helpful assistant that explains notes in plain, accessible language.

Read the following note and explain what it's about as if to someone unfamiliar with the topic.
Keep it to 2–4 sentences. Be direct and clear. No bullet points.

Note:
${noteText}

Explanation:`;

  const explanation = await callGemini(prompt);
  return { explanation };
}