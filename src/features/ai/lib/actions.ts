// src/features/ai/lib/actions.ts
//
// The 3 core AI actions. Each takes a Note + allNotes for context building.
// All calls go through callGemini() — no direct fetch calls here.

import { callGemini } from "@/features/ai/lib/client";
import { buildAIContext, contextToString } from "@/features/ai/lib/buildContext";
import type { Note } from "@/types";

// ─── Summarize ────────────────────────────────────────────────────────────────

export interface SummarizeResult {
  summary: string;
}

export async function summarizeNote(note: Note, allNotes: Note[]): Promise<SummarizeResult> {
  const ctx         = await buildAIContext(note, allNotes);
  const contextText = contextToString(ctx);

  const prompt = `You are a helpful assistant that summarizes notes clearly and concisely.
You have access to context about this note including related notes and backlinks from the same vault.

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
  return { summary };
}

// ─── Generate Tags ────────────────────────────────────────────────────────────

export interface GenerateTagsResult {
  tags: string[];
}

export async function generateTags(note: Note, allNotes: Note[]): Promise<GenerateTagsResult> {
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

  return { tags };
}

// ─── Explain ──────────────────────────────────────────────────────────────────

export interface ExplainResult {
  explanation: string;
}

export async function explainNote(note: Note, allNotes: Note[]): Promise<ExplainResult> {
  const ctx         = await buildAIContext(note, allNotes);
  const contextText = contextToString(ctx);

  const prompt = `You are a helpful assistant that explains notes in plain, accessible language.
You have access to related notes and backlinks from the same vault to help with context.

Read the following note and explain what it's about as if to someone unfamiliar with the topic.
Keep it to 2–4 sentences. Be direct and clear. No bullet points.
Use the related notes context only if it adds meaningful clarity.

${contextText}

Explanation:`;

  const explanation = await callGemini(prompt);
  return { explanation };
}