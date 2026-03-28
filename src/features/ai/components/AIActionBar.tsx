// src/features/ai/components/AIActionBar.tsx
//
// Renders 3 AI action buttons in the editor's top-right button row.
// Only visible when AI is enabled and a note is active.
// Results render in a dismissible panel below the buttons.

import { useState } from "react";
import { useAIStore } from "@/features/ai/store/useAIStore";
import { useNoteStore } from "@/features/notes/store/useNoteStore";
import { summarizeNote, generateTags, explainNote } from "@/features/ai/lib/actions";
import type { Note } from "@/types";

// ─── Types ────────────────────────────────────────────────────────────────────

type ActionType = "summarize" | "tags" | "explain";

interface AIResult {
  action: ActionType;
  content: string;      // summary or explanation text
  tags?: string[];      // only for "tags" action
}

// ─── Spinner ──────────────────────────────────────────────────────────────────

function Spinner() {
  return (
    <svg className="animate-spin" width="11" height="11" viewBox="0 0 12 12" fill="none">
      <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.5"
        strokeDasharray="14 8" strokeLinecap="round" />
    </svg>
  );
}

// ─── Action button ────────────────────────────────────────────────────────────

function AIBtn({
  onClick,
  loading,
  active,
  title,
  children,
}: {
  onClick: () => void;
  loading: boolean;
  active: boolean;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={loading}
      title={title}
      className={`flex items-center gap-1.5 px-2.5 h-7 rounded-full text-xs font-medium transition-all duration-150 border
        ${active
          ? "bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 border-blue-200 dark:border-blue-800"
          : "bg-white dark:bg-zinc-900 text-zinc-400 dark:text-zinc-500 border-zinc-200 dark:border-zinc-700 hover:text-zinc-600 dark:hover:text-zinc-300 hover:border-zinc-300 dark:hover:border-zinc-600"
        }
        disabled:opacity-50 disabled:cursor-not-allowed`}
    >
      {loading ? <Spinner /> : children}
    </button>
  );
}

// ─── Result panel ─────────────────────────────────────────────────────────────

function ResultPanel({
  result,
  onDismiss,
  onApplyTags,
  applyingTags,
  tagsApplied,
}: {
  result: AIResult;
  onDismiss: () => void;
  onApplyTags: (tags: string[]) => void;
  applyingTags: boolean;
  tagsApplied: boolean;
}) {
  const [selectedTags, setSelectedTags] = useState<string[]>(result.tags ?? []);

  function toggleTag(tag: string) {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  }

  const labels: Record<ActionType, string> = {
    summarize: "Summary",
    tags:      "Suggested Tags",
    explain:   "Explanation",
  };

  return (
    <div className="absolute top-12 right-3 z-30 w-80 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-zinc-100 dark:border-zinc-800">
        <div className="flex items-center gap-2">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M6 1v2M6 9v2M1 6h2M9 6h2M2.5 2.5l1.5 1.5M8 8l1.5 1.5M9.5 2.5L8 4M4 8L2.5 9.5"
              stroke="#3b82f6" strokeWidth="1.3" strokeLinecap="round" />
          </svg>
          <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
            {labels[result.action]}
          </span>
        </div>
        <button
          onClick={onDismiss}
          className="w-5 h-5 flex items-center justify-center rounded text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path d="M1.5 1.5l7 7M8.5 1.5l-7 7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      {/* Content */}
      <div className="px-3.5 py-3">
        {result.action === "tags" && result.tags ? (
          <div className="space-y-3">
            <p className="text-xs text-zinc-400 dark:text-zinc-500">Click to select</p>
            <div className="flex flex-wrap gap-1.5">
              {result.tags.map((tag) => (
                <button
                  key={tag}
                  onClick={() => toggleTag(tag)}
                  className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border transition-colors duration-100 ${
                    selectedTags.includes(tag)
                      ? "bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 border-blue-300 dark:border-blue-700"
                      : "bg-zinc-100 dark:bg-zinc-800 text-zinc-400 dark:text-zinc-500 border-zinc-200 dark:border-zinc-700"
                  }`}
                >
                  #{tag}
                </button>
              ))}
            </div>
            <button
              onClick={() => onApplyTags(selectedTags)}
              disabled={selectedTags.length === 0 || applyingTags || tagsApplied}
              className={`w-full py-1.5 rounded-lg text-xs font-medium transition-colors duration-150 ${
                tagsApplied
                  ? "bg-green-50 dark:bg-green-900/30 text-green-600 dark:text-green-400 border border-green-200 dark:border-green-800"
                  : "bg-blue-500 hover:bg-blue-600 text-white disabled:opacity-40 disabled:cursor-not-allowed"
              }`}
            >
              {tagsApplied
                ? "✓ Tags applied"
                : applyingTags
                ? "Applying…"
                : `Apply ${selectedTags.length} tag${selectedTags.length !== 1 ? "s" : ""}`}
            </button>
          </div>
        ) : (
          <div className="space-y-1.5">
            {result.content
            .split("\n")
            .map((line) => line.trim())
            .filter((line) => line.startsWith("-"))
            .map((line, i) => (
                <div key={i} className="flex items-start gap-2 text-sm text-zinc-700 dark:text-zinc-300 mb-1.5">
                <span className="text-blue-400 mt-0.5 shrink-0">•</span>
                <span className="leading-relaxed">{line.slice(1).trim()}</span>
                </div>
            ))
            }
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

interface AIActionBarProps {
  note: Note;
}

export function AIActionBar({ note }: AIActionBarProps) {
  const enabled        = useAIStore((s) => s.enabled);
  const connectionStatus = useAIStore((s) => s.connectionStatus);
  console.log("AIActionBar:", { enabled, connectionStatus, noteId: note.id });
  const updateNote     = useNoteStore((s) => s.updateNote);

  const [loadingAction, setLoadingAction] = useState<ActionType | null>(null);
  const [result, setResult]               = useState<AIResult | null>(null);
  const [error, setError]                 = useState<string | null>(null);
  const [applyingTags, setApplyingTags]   = useState(false);
  const [tagsApplied, setTagsApplied]     = useState(false);

  // Don't render if AI isn't connected + enabled
  if (!enabled || connectionStatus !== "connected") return null;

  function dismiss() {
    setResult(null);
    setError(null);
    setTagsApplied(false);
  }

  async function runAction(action: ActionType) {
    // Toggle off if already showing this result
    if (result?.action === action) { dismiss(); return; }

    setLoadingAction(action);
    setError(null);
    setResult(null);
    setTagsApplied(false);

    try {
      if (action === "summarize") {
        const { summary } = await summarizeNote(note);
        setResult({ action, content: summary });
      } else if (action === "tags") {
        const { tags } = await generateTags(note);
        setResult({ action, content: "", tags });
      } else if (action === "explain") {
        const { explanation } = await explainNote(note);
        setResult({ action, content: explanation });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setLoadingAction(null);
    }
  }

async function handleApplyTags(tags: string[]) {
  setApplyingTags(true);
  try {
    // TagBar uses JSON array format, not comma-separated string
    const existing: string[] = (() => {
      if (!note.tags) return [];
      try { return JSON.parse(note.tags) as string[]; }
      catch { return []; }
    })();
    const merged = [...new Set([...existing, ...tags])];
    await updateNote(note.id, { tags: JSON.stringify(merged) });
    setTagsApplied(true);
  } catch {
    setError("Failed to apply tags.");
  } finally {
    setApplyingTags(false);
  }
}

  const isLoading = loadingAction !== null;

  return (
    <>
      {/* ── Action buttons — rendered inline into the editor's button row ── */}
      <div className="flex items-center gap-1.5">

        {/* Divider */}
        <div className="w-px h-4 bg-zinc-200 dark:bg-zinc-700 mx-0.5" />

        <AIBtn
          onClick={() => runAction("summarize")}
          loading={loadingAction === "summarize"}
          active={result?.action === "summarize"}
          title="Summarize this note"
        >
          <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
            <path d="M1.5 2.5h8M1.5 5h6M1.5 7.5h4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
          Summarize
        </AIBtn>

        <AIBtn
          onClick={() => runAction("tags")}
          loading={loadingAction === "tags"}
          active={result?.action === "tags"}
          title="Generate tags for this note"
        >
          <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
            <path d="M1.5 5.5L5.5 1.5h4v4L5.5 9.5l-4-4z" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
            <circle cx="7.5" cy="3.5" r="0.8" fill="currentColor" />
          </svg>
          Tags
        </AIBtn>

        <AIBtn
          onClick={() => runAction("explain")}
          loading={loadingAction === "explain"}
          active={result?.action === "explain"}
          title="Explain this note"
        >
          <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
            <circle cx="5.5" cy="5.5" r="4" stroke="currentColor" strokeWidth="1.2" />
            <path d="M5.5 5v3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
            <circle cx="5.5" cy="3.5" r="0.6" fill="currentColor" />
          </svg>
          Explain
        </AIBtn>
      </div>

      {/* ── Error toast ── */}
      {error && (
        <div className="absolute top-12 right-3 z-30 flex items-center gap-2 px-3 py-2 rounded-lg bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-xs text-red-600 dark:text-red-400 shadow-lg">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.2" />
            <path d="M6 4v2.5M6 8h.01" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
          {error}
          <button onClick={() => setError(null)} className="ml-1 hover:opacity-70">✕</button>
        </div>
      )}

      {/* ── Result panel ── */}
      {result && !isLoading && (
        <ResultPanel
          result={result}
          onDismiss={dismiss}
          onApplyTags={handleApplyTags}
          applyingTags={applyingTags}
          tagsApplied={tagsApplied}
        />
      )}
    </>
  );
}