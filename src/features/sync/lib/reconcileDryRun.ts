// src/features/sync/lib/reconcileDryRun.ts
//
// Stage 4d.3, batch 2 — READ-ONLY dry run for one note. Builds base / theirs /
// mine exactly as the real review will, runs the diff, the gate and
// applyReconcile, and reports what it found. It writes NOTHING: no local
// writes, no hosted writes, no store changes. Run it from DevTools:
//
//   const m = await import('/src/features/sync/lib/reconcileDryRun.ts');
//   JSON.stringify(await m.dryRunReconcile('<note id>'), null, 1)
//
// What it is for (design rev 2, section 8):
//   - does the diff on a real note match what you expect?
//   - does the gate pass, and if not, which untracked fields differ (to tune
//     the volatile-attribute list)?
//   - how long does the diff take (to set the size guard)?
//   - does a simple text walk of the merged document match the stored
//     `plaintext` column (Q1: plaintext for a merged note)? The stored column
//     comes from the editor's getText(), so this compares the walk against it
//     for the local and the hosted copy.
//
// Note text appears in the report only as short snippets around the first
// difference, in your own console.

import { getNoteById } from "@/features/notes/db/queries";
import { getDb } from "@/features/notes/db/client";
import { getSyncState } from "@/features/sync/lib/noteSyncState";
import { generateText } from "@tiptap/core";
import { PARSE_EXTENSIONS } from "@/features/ai/lib/save/parseMarkdown";
import StarterKit from "@tiptap/starter-kit";
import {
  AttachmentExtension,
  BlockIdExtension,
  BlockRefNode,
  Callout,
  CheckItem,
  CheckList,
  CodeBlock,
  Color,
  DataviewNode,
  EditorTable,
  ImageExtension,
  Mathematics,
  MultiHighlight,
  TableCell,
  TableHeader,
  TableRow,
  TextStyle,
  Toggle,
  ToggleBody,
  ToggleSummary,
} from "@/features/editor/components/Editor/extensions";
import { SubPageNode } from "@/features/editor/components/Editor/SubPageNode";
import { PDFLinkNode } from "@/features/editor/components/Editor/PDFLinkNode";
import { NoteLink } from "@/features/editor/components/Editor/NoteLink";
import { DateChipExtension } from "@/features/editor/components/Editor/DateChipExtension";
import { supabase } from "@/features/sync/db/supabaseClient";
import { loadBlockMapAtRevision, loadLiveBlockMap } from "@/features/notes/lib/blockRevisioning";
import { diffNoteRevisions } from "@/features/notes/lib/threeWayDiff";
import { applyReconcile, itemsFromDiff } from "@/features/notes/lib/applyReconcile";
import {
  containerShells,
  describeGateReason,
  differingPaths,
  evaluateGate,
  untrackedSequence,
  type DocNode,
} from "@/features/notes/lib/reconcileGate";

const SNIPPET = 40;
const MAX_LISTED = 40;

// Text between textblocks is joined with a blank line, as editor.getText() does
// by default. Whether the real output matches is exactly what this measures.
function plainTextOf(doc: DocNode): string {
  const blocks: string[] = [];
  const TEXTBLOCKS = new Set(["paragraph", "heading", "codeBlock"]); // empty ones still count as a block
  const isInline = (n: DocNode) => n.type === "text" || n.type === "hardBreak";
  const textOf = (n: DocNode): string =>
    n.type === "text" ? String(n.text ?? "") : n.type === "hardBreak" ? "\n" : (n.content ?? []).map(textOf).join("");
  const walk = (n: DocNode): void => {
    const kids = n.content ?? [];
    if (TEXTBLOCKS.has(n.type ?? "") || (kids.length > 0 && kids.every(isInline))) {
      blocks.push(kids.map(textOf).join(""));
      return;
    }
    for (const k of kids) walk(k);
  };
  walk(doc);
  return blocks.join("\n\n");
}

function compareText(walk: string, stored: string | null | undefined) {
  const s = stored ?? "";
  let i = 0;
  const max = Math.min(walk.length, s.length);
  while (i < max && walk[i] === s[i]) i++;
  const same = walk === s;
  return {
    walkLength: walk.length,
    storedLength: s.length,
    same,
    firstDifferenceAt: same ? null : i,
    walkSnippet: same ? null : walk.slice(Math.max(0, i - 10), i + SNIPPET),
    storedSnippet: same ? null : s.slice(Math.max(0, i - 10), i + SNIPPET),
  };
}

function parse(content: string | null | undefined): DocNode | null {
  try {
    return JSON.parse(content ?? "") as DocNode;
  } catch {
    return null;
  }
}

// The live editor's schema extensions (from Editor/index.tsx), without the UI-only plugins.
const LIVE_SCHEMA = [
  StarterKit.configure({ codeBlock: false }),
  Color,
  TextStyle,
  MultiHighlight,
  CodeBlock,
  Callout,
  CheckList,
  CheckItem,
  EditorTable,
  TableRow,
  TableHeader,
  TableCell,
  ToggleSummary,
  ToggleBody,
  Toggle,
  ImageExtension,
  AttachmentExtension,
  SubPageNode,
  PDFLinkNode,
  BlockIdExtension,
  BlockRefNode,
  DataviewNode,
  NoteLink.configure({ onNavigate: () => {} }),
  DateChipExtension.configure({ noteId: "", getTitle: () => "Untitled" }),
  Mathematics.configure({ katexOptions: { throwOnError: false } }),
];

function tryGenerate(doc: DocNode, exts: typeof PARSE_EXTENSIONS = PARSE_EXTENSIONS): string | { error: string } {
  try {
    return generateText(doc as Parameters<typeof generateText>[0], exts, { blockSeparator: "\n\n" });
  } catch (e) {
    return { error: String(e).slice(0, 160) };
  }
}

export async function dryRunReconcile(noteId: string) {
  const started = performance.now();

  const local = await getNoteById(noteId);
  const state = await getSyncState(noteId);
  const { data, error } = await supabase
    .from("notes")
    .select("id, title, content, plaintext, revision, deleted_at, purged_at, updated_at")
    .eq("id", noteId)
    .maybeSingle();
  if (error) throw new Error(`remote fetch failed (${error.code ?? "?"}): ${error.message}`);

  const remote = data as {
    title: string;
    content: string;
    plaintext: string | null;
    revision: number;
    deleted_at: string | null;
    purged_at: string | null;
  } | null;

  const header = {
    noteId,
    localPresent: !!local,
    remotePresent: !!remote,
    remotePurged: remote?.purged_at != null,
    remoteTrashed: remote?.deleted_at != null,
    syncState: state,
    hostedRevision: remote?.revision ?? null,
  };
  if (!local || !remote) return { ...header, stopped: "note missing on one side; nothing to merge here" };

  const mineDoc = parse(local.content);
  const theirsDoc = parse(remote.content);
  if (!mineDoc || !theirsDoc) return { ...header, stopped: "content could not be parsed on one side" };

  // Maps, exactly as the review will build them.
  const base = state ? await loadBlockMapAtRevision(noteId, state.localRevision) : null;
  const theirsMap = await loadLiveBlockMap(remote.content);
  const mineMap = await loadLiveBlockMap(local.content ?? "");

  const t0 = performance.now();
  const results = diffNoteRevisions(base, theirsMap, mineMap);
  const diffMs = Math.round(performance.now() - t0);

  const byClass: Record<string, number> = {};
  for (const r of results) byClass[r.classification] = (byClass[r.classification] ?? 0) + 1;

  // Apply with conflicts defaulted to "keep mine" (dry run only: the real review has no default).
  const items = itemsFromDiff(results, {}, "keep_mine");
  const applied = applyReconcile(mineDoc, theirsDoc, items);

  // The gate, plus where the untracked content differs.
  const gate = evaluateGate(theirsDoc, mineDoc);
  const seqTheirs = untrackedSequence(theirsDoc);
  const seqMine = untrackedSequence(mineDoc);
  const untrackedDiffs: Array<{ position: number; paths: string[] }> = [];
  for (let i = 0; i < Math.max(seqTheirs.length, seqMine.length); i++) {
    if (seqTheirs[i] !== seqMine[i]) {
      untrackedDiffs.push({
        position: i,
        paths:
          seqTheirs[i] && seqMine[i]
            ? differingPaths(JSON.parse(seqTheirs[i]), JSON.parse(seqMine[i]))
            : [seqTheirs[i] ? "only in theirs" : "only in mine"],
      });
    }
  }
  const shellsTheirs = containerShells(theirsDoc);
  const shellsMine = containerShells(mineDoc);
  const containerDiffs = [...shellsTheirs.keys()]
    .filter((id) => shellsMine.has(id) && shellsTheirs.get(id) !== shellsMine.get(id))
    .slice(0, 10)
    .map((id) => ({
      blockId: id,
      paths: differingPaths(JSON.parse(shellsTheirs.get(id) as string), JSON.parse(shellsMine.get(id) as string)),
    }));

  return {
    ...header,
    maps: { base: base ? base.size : null, theirs: theirsMap.size, mine: mineMap.size },
    baseNote: base ? "local snapshot at the synced revision" : "no base found: direct theirs-vs-mine compare",
    diff: {
      ms: diffMs,
      counts: byClass,
      items: results.slice(0, MAX_LISTED).map((r) => ({ blockId: r.blockId, classification: r.classification, default: r.defaultAction ?? null })),
      listedAll: results.length <= MAX_LISTED,
    },
    gate: gate.ok
      ? { ok: true }
      : { ok: false, reasons: gate.reasons.map((r) => ({ code: r.code, side: r.side, detail: r.detail, words: describeGateReason(r) })) },
    untrackedDiffs,
    containerDiffs,
    applied: applied.ok
      ? { ok: true, counts: applied.counts, notes: applied.notes }
      : { ok: false, reason: applied.reason, detail: applied.detail.slice(0, 10) },
    plaintext: {
      mineWalkVersusStored: compareText(plainTextOf(mineDoc), local.plaintext),
      theirsWalkVersusStored: compareText(plainTextOf(theirsDoc), remote.plaintext),
      mergedWalkLength: applied.ok ? plainTextOf(applied.doc).length : null,
      generatedMineVsStored: (() => {
        const g = tryGenerate(mineDoc);
        return typeof g === "string" ? compareText(g, local.plaintext) : g;
      })(),
      generatedTheirsVsStored: (() => {
        const g = tryGenerate(theirsDoc);
        return typeof g === "string" ? compareText(g, remote.plaintext) : g;
      })(),
    },
    totalMs: Math.round(performance.now() - started),
    wroteAnything: false,
  };
}


/** Read-only: how often does generateText match the stored plaintext? Samples random non-canvas notes. */
export async function plaintextParity(sample = 300, which: "live" | "headless" = "live") {
  const db = await getDb();
  const rows = await db.select<Array<{ id: string; content: string; plaintext: string | null }>>(
    `SELECT id, content, plaintext FROM notes WHERE is_canvas = 0 ORDER BY RANDOM() LIMIT $1`,
    [sample]
  );
  let same = 0;
  let differ = 0;
  let threw = 0;
  const errors: Record<string, number> = {};
  const mismatches: Array<{ id: string; walkLength: number; storedLength: number; firstDifferenceAt: number | null }> = [];
  for (const r of rows) {
    const doc = parse(r.content);
    if (!doc) continue;
    const g = tryGenerate(doc, which === "live" ? (LIVE_SCHEMA as unknown as typeof PARSE_EXTENSIONS) : PARSE_EXTENSIONS);
    if (typeof g !== "string") {
      threw++;
      errors[g.error] = (errors[g.error] ?? 0) + 1;
      continue;
    }
    const c = compareText(g, r.plaintext);
    if (c.same) same++;
    else {
      differ++;
      if (mismatches.length < 10) {
        mismatches.push({ id: r.id, walkLength: c.walkLength, storedLength: c.storedLength, firstDifferenceAt: c.firstDifferenceAt });
      }
    }
  }
  return { sampled: rows.length, same, differ, threw, errors, mismatches, wroteAnything: false };
}


/** Read-only: why does generated text differ from the stored plaintext for one note? */
export async function plaintextWhy(noteId: string) {
  const n = await getNoteById(noteId);
  const doc = parse(n?.content);
  if (!n || !doc) return { error: "note missing or content unparseable" };
  const g = tryGenerate(doc, LIVE_SCHEMA as unknown as typeof PARSE_EXTENSIONS);
  const types: Record<string, number> = {};
  const walk = (x: DocNode): void => {
    types[x.type ?? "?"] = (types[x.type ?? "?"] ?? 0) + 1;
    for (const c of x.content ?? []) walk(c);
  };
  walk(doc);
  return {
    title: n.title,
    sourceType: (n as { source_type?: string }).source_type ?? null,
    compare: typeof g === "string" ? compareText(g, n.plaintext) : g,
    nodeTypes: types,
    wroteAnything: false,
  };
}
