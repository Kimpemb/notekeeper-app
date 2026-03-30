// src/features/ai/lib/actions.ts
//
// The 3 core AI actions. Each takes a Note + allNotes for context building.
// All calls go through callGemini() — no direct fetch calls here.
// Results are persisted to ai_summaries / ai_tag_cache after each call.
// Session memory (ai_history) is injected into prompts and written back.

import { callGemini } from "@/features/ai/lib/client";
import { buildAIContext, contextToString } from "@/features/ai/lib/buildContext";
import {
  getAISummary,
  upsertAISummary,
  getAITagCache,
  upsertAITagCache,
  getAIHistory,
  appendAIHistory,
} from "@/features/notes/db/queries";
import type { Note } from "@/types";

// ─── Session memory helper ────────────────────────────────────────────────────

async function buildHistoryBlock(noteId: string): Promise<string> {
  const history = await getAIHistory(noteId);
  if (history.length === 0) return "";
  const lines = history.map((h) =>
    `${h.role === "user" ? "User" : "Assistant"}: ${h.content.slice(0, 300)}`
  );
  return `\nPrevious interactions on this note:\n${lines.join("\n")}\n`;
}

// ─── Summarize ────────────────────────────────────────────────────────────────

export interface SummarizeResult {
  summary: string;
  fromCache: boolean;
}

export async function summarizeNote(note: Note, allNotes: Note[]): Promise<SummarizeResult> {
  // ── Check DB cache first ──────────────────────────────────────────────────
  const cached = await getAISummary(note.id, note.updated_at);
  if (cached) return { summary: cached, fromCache: true };

  const ctx         = await buildAIContext(note, allNotes);
  const contextText = contextToString(ctx);
  const historyBlock = await buildHistoryBlock(note.id);

  const prompt = `You are a helpful assistant that summarizes notes clearly and concisely.
You have access to context about this note including related notes and backlinks from the same vault.
${historyBlock}
Summarize the following note as exactly 4 bullet points. Rules:
- Each bullet MUST be on its own line
- Format exactly like this, one per line:
- First key point here
- Second key point here
- Third key point here
- Fourth key point here
- One sentence per bullet maximum
- Use the related notes context to add depth where relevant
- Return ONLY the bullets, no intro, no preamble

${contextText}

Summary:`;

  const summary = await callGemini(prompt);

  // ── Persist to DB ─────────────────────────────────────────────────────────
  await upsertAISummary(note.id, summary, note.updated_at);

  // ── Write to session memory ───────────────────────────────────────────────
  await appendAIHistory(note.id, "user", "Summarize this note");
  await appendAIHistory(note.id, "assistant", summary);

  return { summary, fromCache: false };
}

// ─── Generate Tags ────────────────────────────────────────────────────────────

export interface GenerateTagsResult {
  tags: string[];
  fromCache: boolean;
}

export async function generateTags(note: Note, allNotes: Note[]): Promise<GenerateTagsResult> {
  // ── Check DB cache first ──────────────────────────────────────────────────
  const cached = await getAITagCache(note.id, note.updated_at);
  if (cached) return { tags: cached, fromCache: true };

  const ctx         = await buildAIContext(note, allNotes);
  const contextText = contextToString(ctx);

  const existingTags = ctx.allTags.length > 0
    ? `\nExisting tags in this vault (prefer these where relevant): ${ctx.allTags.slice(0, 20).join(", ")}`
    : "";

  const prompt = `You are a helpful assistant that generates concise, relevant tags for notes.

Generate 2 to 3 tags for the following note. Rules:
- Lowercase only
- Single words or short hyphenated phrases (e.g. "project-planning")
- No # prefix
- Prefer tags already used in the vault for consistency
- Return ONLY a comma-separated list, nothing else. No explanation, no preamble.
${existingTags}

${contextText}

Tags:`;

  const raw = await callGemini(prompt);

  const tags = raw
    .split(",")
    .map((t) => t.trim().toLowerCase().replace(/^#+/, "").replace(/\s+/g, "-"))
    .filter((t) => t.length > 0 && t.length < 40)
    .slice(0, 3);

  // ── Persist to DB ─────────────────────────────────────────────────────────
  await upsertAITagCache(note.id, tags, note.updated_at);

  return { tags, fromCache: false };
}

// ─── Explain ──────────────────────────────────────────────────────────────────

export interface ExplainResult {
  explanation: string;
}

export async function explainNote(note: Note, allNotes: Note[]): Promise<ExplainResult> {
  const ctx         = await buildAIContext(note, allNotes);
  const contextText = contextToString(ctx);
  const historyBlock = await buildHistoryBlock(note.id);

  const prompt = `You are a helpful assistant that explains notes in plain, accessible language.
You have access to related notes and backlinks from the same vault to help with context.
${historyBlock}
Read the following note and explain what it's about as if to someone unfamiliar with the topic.
Keep it to 2–4 sentences. Be direct and clear. No bullet points.
Use the related notes context only if it adds meaningful clarity.

${contextText}

Explanation:`;

  const explanation = await callGemini(prompt);

  // ── Write to session memory ───────────────────────────────────────────────
  await appendAIHistory(note.id, "user", "Explain this note");
  await appendAIHistory(note.id, "assistant", explanation);

  return { explanation };
}