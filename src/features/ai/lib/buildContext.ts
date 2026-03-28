// src/features/ai/lib/buildContext.ts
//
// Assembles a rich context object for every AI call.
// Used by actions.ts to give Gemini awareness beyond just the current note.

import type { Note } from "@/types";
import { getSimilarityResults } from "@/features/notes/similarity/similarityUtils";
import { getAllBacklinks } from "@/features/notes/db/queries";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface NoteContext {
  currentNote: {
    title: string;
    body: string;
    tags: string[];
    frontmatter: Record<string, string>;
  };
  relatedNotes: {
    title: string;
    body: string;
    tags: string[];
  }[];
  backlinkTitles: string[];
  allTags: string[];
}

// ─── Frontmatter parser ───────────────────────────────────────────────────────

function parseFrontmatter(raw: string | null): Record<string, string> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed === "object" && parsed !== null) return parsed;
    return {};
  } catch {
    return {};
  }
}

// ─── Tag parser ───────────────────────────────────────────────────────────────

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

// ─── Context builder ──────────────────────────────────────────────────────────

/**
 * Builds a NoteContext for a given note.
 * Pulls top 3 similar notes algorithmically and up to 5 backlink titles from DB.
 * Keeps context lean — only title + plaintext body for related notes.
 */
export async function buildAIContext(
  note: Note,
  allNotes: Note[]
): Promise<NoteContext> {
  // ── Current note ──────────────────────────────────────────────────────────
  const currentTags        = parseTags(note.tags);
  const currentFrontmatter = parseFrontmatter(note.frontmatter);
  const currentBody        = note.plaintext?.trim() ?? "";

  // ── Similar notes (algorithmic, top 3) ───────────────────────────────────
  const similarResults = getSimilarityResults(note, allNotes, [], new Set(), 3);
  const relatedNotes = similarResults
    .map((r) => allNotes.find((n) => n.id === r.noteId))
    .filter((n): n is Note => n !== undefined)
    .map((n) => ({
      title: n.title,
      body: (n.plaintext ?? "").slice(0, 500), // keep related notes brief
      tags: parseTags(n.tags),
    }));

  // ── Backlinks (titles only) ───────────────────────────────────────────────
  let backlinkTitles: string[] = [];
  try {
const allBacklinks = await getAllBacklinks();
const backlinks = allBacklinks.filter((b: { source_id: string; target_id: string }) => b.target_id === note.id);
backlinkTitles = backlinks
  .map((b: { source_id: string; target_id: string }) => allNotes.find((n) => n.id === b.source_id)?.title)
  .filter((t: string | undefined): t is string => t !== undefined)
  .slice(0, 5);
  } catch {
    backlinkTitles = [];
  }

  // ── All tags across the vault ─────────────────────────────────────────────
  const allTagsSet = new Set<string>();
  for (const n of allNotes) {
    for (const tag of parseTags(n.tags)) {
      allTagsSet.add(tag);
    }
  }

  return {
    currentNote: {
      title: note.title,
      body: currentBody.slice(0, 6000),
      tags: currentTags,
      frontmatter: currentFrontmatter,
    },
    relatedNotes,
    backlinkTitles,
    allTags: [...allTagsSet].slice(0, 50),
  };
}

// ─── Context → prompt string ──────────────────────────────────────────────────

/**
 * Serializes NoteContext into a compact string for injection into prompts.
 * Each section is clearly labelled so Gemini can parse the structure.
 */
export function contextToString(ctx: NoteContext): string {
  const lines: string[] = [];

  lines.push(`Note: ${ctx.currentNote.title}`);

  if (ctx.currentNote.tags.length > 0) {
    lines.push(`Tags: ${ctx.currentNote.tags.join(", ")}`);
  }

  if (Object.keys(ctx.currentNote.frontmatter).length > 0) {
    const fm = Object.entries(ctx.currentNote.frontmatter)
      .map(([k, v]) => `${k}: ${v}`)
      .join(", ");
    lines.push(`Properties: ${fm}`);
  }

  if (ctx.backlinkTitles.length > 0) {
    lines.push(`Linked from: ${ctx.backlinkTitles.join(", ")}`);
  }

  if (ctx.relatedNotes.length > 0) {
    lines.push(`\nRelated notes in this vault:`);
    for (const related of ctx.relatedNotes) {
      lines.push(`- "${related.title}"${related.tags.length > 0 ? ` [${related.tags.join(", ")}]` : ""}`);
      if (related.body) lines.push(`  ${related.body.slice(0, 200)}`);
    }
  }

  lines.push(`\nNote content:\n${ctx.currentNote.body}`);

  return lines.join("\n");
}