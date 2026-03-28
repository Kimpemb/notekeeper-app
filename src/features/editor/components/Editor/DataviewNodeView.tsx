// src/features/editor/components/Editor/DataviewNodeView.tsx
//
// Renders a live, queryable table of notes filtered by frontmatter properties.
//
// ── Query syntax (one filter per line) ───────────────────────────────────────
//   type: meeting               → frontmatter key "type" equals "meeting"
//   status: open                → frontmatter key "status" equals "open"
//   status:                     → any note that has a "status" field
//   sort: updated_at desc       → sort by updated_at descending
//   sort: title asc             → sort alphabetically by title
//   limit: 10                   → max rows (default 20)
//   columns: title, status, due → explicit column list (overrides auto-derive)
//
// ── Special sort fields ───────────────────────────────────────────────────────
//   title, created_at, updated_at  → note-level fields
//   anything else                  → treated as a frontmatter key
//
// ── Behaviour ─────────────────────────────────────────────────────────────────
//   Click row        → navigate to note
//   Click edit icon  → toggle query editor
//   Results refresh  → on every notes store change

import { useState, useMemo, useRef, useEffect } from "react";
import { NodeViewWrapper } from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/react";
import { useNoteStore } from "@/features/notes/store/useNoteStore";
import { useUIStore } from "@/features/ui/store/useUIStore";
import type { Note } from "@/types";

// ── Query parser ──────────────────────────────────────────────────────────────

interface ParsedQuery {
  filters:  { key: string; value: string }[];
  sort:     { field: string; dir: "asc" | "desc" };
  limit:    number;
  columns:  string[] | null; // null = auto-derive
}

function parseQuery(raw: string): ParsedQuery {
  const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);
  const filters: { key: string; value: string }[] = [];
  let sortField = "updated_at";
  let sortDir: "asc" | "desc" = "desc";
  let limit = 20;
  let columns: string[] | null = null;

  for (const line of lines) {
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const key   = line.slice(0, colonIdx).trim().toLowerCase();
    const value = line.slice(colonIdx + 1).trim();

    if (key === "sort") {
      const parts = value.split(/\s+/);
      sortField = parts[0] ?? "updated_at";
      sortDir   = parts[1]?.toLowerCase() === "asc" ? "asc" : "desc";
    } else if (key === "limit") {
      const n = parseInt(value, 10);
      if (!isNaN(n) && n > 0) limit = Math.min(n, 100);
    } else if (key === "columns") {
      columns = value.split(",").map((c) => c.trim().toLowerCase()).filter(Boolean);
    } else {
      filters.push({ key, value: value.toLowerCase() });
    }
  }

  return { filters, sort: { field: sortField, dir: sortDir }, limit, columns };
}

// ── Note matcher ──────────────────────────────────────────────────────────────

function matchesFilters(note: Note, filters: ParsedQuery["filters"]): boolean {
  if (filters.length === 0) return true;
  let fm: Record<string, string> = {};
  if (note.frontmatter) {
    try { fm = JSON.parse(note.frontmatter); } catch { fm = {}; }
  }
  return filters.every(({ key, value }) => {
    const noteVal = (fm[key] ?? "").toString().toLowerCase();
    if (!value) return key in fm; // "status:" = has this field
    if (!noteVal) return false;
    return noteVal === value || noteVal.includes(value);
  });
}

// ── Sorter ────────────────────────────────────────────────────────────────────

const NOTE_SORT_FIELDS = new Set(["title", "created_at", "updated_at"]);

function sortNotes(notes: Note[], sort: ParsedQuery["sort"]): Note[] {
  return [...notes].sort((a, b) => {
    let av: string | number;
    let bv: string | number;

    if (NOTE_SORT_FIELDS.has(sort.field)) {
      const field = sort.field as keyof Note;
      av = (a[field] as string | number) ?? "";
      bv = (b[field] as string | number) ?? "";
    } else {
      const getFm = (n: Note) => {
        try { return (JSON.parse(n.frontmatter ?? "{}") as Record<string, string>)[sort.field] ?? ""; }
        catch { return ""; }
      };
      av = getFm(a);
      bv = getFm(b);
    }

    if (av < bv) return sort.dir === "asc" ? -1 : 1;
    if (av > bv) return sort.dir === "asc" ? 1 : -1;
    return 0;
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getFrontmatter(note: Note): Record<string, string> {
  try { return JSON.parse(note.frontmatter ?? "{}") as Record<string, string>; }
  catch { return {}; }
}

// Detect ISO date strings (YYYY-MM-DD or YYYY-MM-DDTHH:mm...)
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?/;

function formatCellValue(val: string): string {
  if (!val) return "";
  if (ISO_DATE_RE.test(val)) {
    const d = new Date(val);
    if (!isNaN(d.getTime())) {
      return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
    }
  }
  return val;
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

// ── Component ─────────────────────────────────────────────────────────────────

export function DataviewNodeView({ node, updateAttributes }: NodeViewProps) {
  const { query } = node.attrs as { query: string };

  const [editing, setEditing] = useState(query === "");
  const [draft,   setDraft]   = useState(query);
  const textareaRef           = useRef<HTMLTextAreaElement>(null);

  const notes     = useNoteStore((s) => s.notes);
  const setActive = useNoteStore((s) => s.setActiveNote);
  const openTab   = useUIStore((s) => s.openTab);

  useEffect(() => {
    if (editing) setTimeout(() => textareaRef.current?.focus(), 50);
  }, [editing]);

  const parsed = useMemo(() => parseQuery(query), [query]);

  const results = useMemo(() => {
    const filtered = notes.filter((n) => n.deleted_at === null && matchesFilters(n, parsed.filters));
    return sortNotes(filtered, parsed.sort).slice(0, parsed.limit);
  }, [notes, parsed]);

  // Column resolution — explicit columns win, otherwise auto-derive from filter keys + fm keys
  const fmColumns = useMemo(() => {
    if (parsed.columns) {
      // User specified columns — exclude "title" and "updated" since those are always shown
      return parsed.columns.filter((c) => c !== "title" && c !== "updated");
    }
    const filterKeys = parsed.filters.map((f) => f.key);
    const allKeys = new Set<string>(filterKeys);
    for (const note of results) {
      Object.keys(getFrontmatter(note)).forEach((k) => allKeys.add(k));
    }
    return [...allKeys].slice(0, 4); // cap at 4 when auto-derived
  }, [results, parsed]);

  function saveQuery() {
    updateAttributes({ query: draft });
    setEditing(false);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") { setDraft(query); setEditing(false); }
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") saveQuery();
  }

  function navigateTo(noteId: string) {
    setActive(noteId);
    openTab(noteId);
  }

  return (
    <NodeViewWrapper>
      <div className="my-2 rounded-xl border border-zinc-200 dark:border-zinc-700 overflow-hidden bg-white dark:bg-zinc-900">

        {/* Header */}
        <div className="flex items-center justify-between px-3 py-2 bg-zinc-50 dark:bg-zinc-800/60 border-b border-zinc-200 dark:border-zinc-700">
          <div className="flex items-center gap-2">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="text-indigo-400 shrink-0">
              <rect x="1" y="1" width="10" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.2"/>
              <path d="M1 4h10M4 4v7" stroke="currentColor" strokeWidth="1"/>
            </svg>
            <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
              Dataview
              {!editing && results.length > 0 && (
                <span className="ml-1.5 text-zinc-400 dark:text-zinc-500 font-normal">
                  {results.length} {results.length === 1 ? "note" : "notes"}
                </span>
              )}
            </span>
          </div>
          <button
            onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
            onClick={() => { if (editing) { saveQuery(); } else { setDraft(query); setEditing(true); } }}
            className="text-[10px] text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 flex items-center gap-1 transition-colors"
          >
            {editing ? (
              <>
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                  <path d="M2 5l2.5 2.5L8 2.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                Save
              </>
            ) : (
              <>
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                  <path d="M7 1.5l1.5 1.5L3 8.5H1.5V7L7 1.5z" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                Edit query
              </>
            )}
          </button>
        </div>

        {/* Query editor */}
        {editing && (
          <div className="p-3 border-b border-zinc-200 dark:border-zinc-700 bg-zinc-50/50 dark:bg-zinc-800/30">
            <textarea
              ref={textareaRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={"type: meeting\nstatus: open\ncolumns: title, status, due\nsort: updated_at desc\nlimit: 10"}
              rows={5}
              className="w-full text-xs font-mono bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg px-3 py-2 text-zinc-700 dark:text-zinc-300 placeholder:text-zinc-300 dark:placeholder:text-zinc-600 focus:outline-none focus:border-indigo-400 dark:focus:border-indigo-500 resize-none"
            />
            <div className="mt-1.5 flex items-center justify-between">
              <p className="text-[10px] text-zinc-400 dark:text-zinc-500 leading-relaxed">
                <span className="font-mono">key: value</span> · <span className="font-mono">columns: a, b, c</span> · <span className="font-mono">sort: field asc|desc</span> · <span className="font-mono">limit: N</span>
              </p>
              <p className="text-[10px] text-zinc-400 dark:text-zinc-500 shrink-0 ml-2">⌘↵ to save</p>
            </div>
          </div>
        )}

        {/* Results table */}
        {!editing && (
          results.length === 0 ? (
            <div className="px-4 py-6 text-sm text-zinc-400 dark:text-zinc-500 text-center">
              {query.trim() ? "No notes match this query" : "No filters set — edit query to get started"}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-100 dark:border-zinc-800">
                    <th className="px-3 py-2 text-left text-[11px] font-medium text-zinc-400 dark:text-zinc-500 whitespace-nowrap">
                      Title
                    </th>
                    {fmColumns.map((col) => (
                      <th key={col} className="px-3 py-2 text-left text-[11px] font-medium text-zinc-400 dark:text-zinc-500 whitespace-nowrap capitalize">
                        {col}
                      </th>
                    ))}
                    <th className="px-3 py-2 text-left text-[11px] font-medium text-zinc-400 dark:text-zinc-500 whitespace-nowrap">
                      Updated
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((note, i) => {
                    const fm = getFrontmatter(note);
                    return (
                      <tr
                        key={note.id}
                        onClick={() => navigateTo(note.id)}
                        className={[
                          "cursor-pointer transition-colors duration-75",
                          i % 2 === 0 ? "bg-white dark:bg-zinc-900" : "bg-zinc-50/50 dark:bg-zinc-800/20",
                          "hover:bg-indigo-50/50 dark:hover:bg-indigo-950/30",
                        ].join(" ")}
                      >
                        <td className="px-3 py-2 text-zinc-800 dark:text-zinc-200 font-medium whitespace-nowrap max-w-48 truncate">
                          {note.title}
                        </td>
                        {fmColumns.map((col) => {
                          const raw = fm[col] ?? "";
                          return (
                            <td key={col} className="px-3 py-2 text-zinc-500 dark:text-zinc-400 whitespace-nowrap max-w-32 truncate text-xs">
                              {raw
                                ? formatCellValue(raw)
                                : <span className="text-zinc-300 dark:text-zinc-600">—</span>
                              }
                            </td>
                          );
                        })}
                        <td className="px-3 py-2 text-zinc-400 dark:text-zinc-500 whitespace-nowrap text-xs">
                          {formatDate(note.updated_at)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )
        )}
      </div>
    </NodeViewWrapper>
  );
}