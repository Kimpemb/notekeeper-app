// src/features/ai/lib/chat.ts
//
// "Chat with your notes" — answers questions using stored ai_summaries
// as vault-wide context, plus the current note's full content.
// Falls back gracefully if no summaries exist yet.

import { callGemini } from "@/features/ai/lib/client";
import {
  getAllAISummaries,
  getAIHistory,
  appendAIHistory,
} from "@/features/notes/db/queries";
import type { Note } from "@/types";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: number;
}

export interface ChatResult {
  answer: string;
  sourceTitles: string[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Scores notes by relevance to the query using simple keyword overlap.
 * Good enough for context selection — we're not building a vector DB.
 */
function scoreNoteRelevance(query: string, noteTitle: string, summary: string): number {
  const q = query.toLowerCase();
  const words = q.split(/\s+/).filter((w) => w.length > 2);
  const target = `${noteTitle} ${summary}`.toLowerCase();
  return words.reduce((acc, word) => acc + (target.includes(word) ? 1 : 0), 0);
}

/**
 * Picks the top N most relevant notes for the query.
 * Uses stored summaries as the relevance signal.
 */
function selectRelevantNotes(
  query: string,
  allNotes: Note[],
  summaryMap: Map<string, string>,
  topN = 5
): { note: Note; summary: string }[] {
  const scored = allNotes
    .filter((n) => summaryMap.has(n.id))
    .map((note) => {
      const summary = summaryMap.get(note.id)!;
      const score = scoreNoteRelevance(query, note.title, summary);
      return { note, summary, score };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topN);

  return scored.map(({ note, summary }) => ({ note, summary }));
}

// ─── Session memory for chat ──────────────────────────────────────────────────

/**
 * For chat, we use a special noteId sentinel "chat_global" so history
 * persists across notes. Per-note chat history uses the actual noteId.
 */
async function buildChatHistoryBlock(noteId: string): Promise<string> {
  const history = await getAIHistory(noteId);
  if (history.length === 0) return "";
  const lines = history.map((h) =>
    `${h.role === "user" ? "User" : "Assistant"}: ${h.content.slice(0, 400)}`
  );
  return `\nConversation so far:\n${lines.join("\n")}\n`;
}

// ─── Main chat function ───────────────────────────────────────────────────────

/**
 * Answers a user question using:
 * 1. Stored ai_summaries for relevant vault context
 * 2. Current note's full content (if provided)
 * 3. Session memory (last 3 exchanges for this noteId)
 *
 * noteId: pass the active note's ID for per-note chat, or "chat_global" for vault-wide chat
 */
export async function chatWithNotes(
  query: string,
  allNotes: Note[],
  noteId: string,
  currentNote?: Note
): Promise<ChatResult> {
  // ── Pull stored summaries ─────────────────────────────────────────────────
  const summaryMap = await getAllAISummaries();

  // ── Find relevant notes ───────────────────────────────────────────────────
  const relevant = selectRelevantNotes(query, allNotes, summaryMap, 5);
  const sourceTitles = relevant.map((r) => r.note.title);

  // ── Build vault context block ─────────────────────────────────────────────
  let vaultContext = "";
  if (relevant.length > 0) {
    const lines = relevant.map(
      (r) => `Note: "${r.note.title}"\nSummary: ${r.summary}`
    );
    vaultContext = `\nRelevant notes from your vault:\n${lines.join("\n\n")}`;
  } else if (summaryMap.size === 0) {
    vaultContext = `\n(No summaries stored yet. Use Summarize on your notes to build context over time.)`;
  } else {
    vaultContext = `\n(No notes closely matched this query. Answering from general knowledge.)`;
  }

  // ── Current note context ──────────────────────────────────────────────────
  let currentNoteBlock = "";
  if (currentNote) {
    currentNoteBlock = `\nCurrent note you're viewing:
Title: ${currentNote.title}
Content: ${(currentNote.plaintext ?? "").slice(0, 2000)}`;
  }

  // ── Session memory ────────────────────────────────────────────────────────
  const historyBlock = await buildChatHistoryBlock(noteId);

  // ── Build prompt ──────────────────────────────────────────────────────────
  const prompt = `You are a knowledgeable assistant with access to a personal notes vault.
Answer the user's question using the context from their notes where relevant.
Be concise and direct. If the notes don't contain relevant information, say so honestly.
${historyBlock}${vaultContext}${currentNoteBlock}

User question: ${query}

Answer:`;

  const answer = await callGemini(prompt);

  // ── Persist to session memory ─────────────────────────────────────────────
  await appendAIHistory(noteId, "user", query);
  await appendAIHistory(noteId, "assistant", answer);

  return { answer, sourceTitles };
}