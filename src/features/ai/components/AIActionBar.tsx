// src/features/ai/components/AIActionBar.tsx
//
// Renders 3 AI action buttons in the editor's top-right button row.
// Only visible when AI is enabled and a note is active.
// Results render in a dismissible panel below the buttons.

import { useEffect, useState } from "react";
import { useAIStore } from "@/features/ai/store/useAIStore";
import { useNoteStore } from "@/features/notes/store/useNoteStore";
import { summarizeNote, generateTags, explainNote } from "@/features/ai/lib/actions";
import { getCached, setCached } from "@/features/ai/lib/cache";
import type { Note } from "@/types";

// ─── Types ────────────────────────────────────────────────────────────────────

type ActionType = "summarize" | "tags" | "explain";

interface AIResult {
  action: ActionType;
  content: string;
  tags?: string[];
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
  onClick, loading, active, title, children,
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
          ? "bg-blue-50 /30 text-blue-600  border-blue-200 "
          : "bg-idemora-bg-primary text-idemora-text-muted border-idemora-border     :"
        }
        disabled:opacity-50 disabled:cursor-not-allowed`}
    >
      {loading ? <Spinner /> : children}
    </button>
  );
}

// ─── Result panel ─────────────────────────────────────────────────────────────

// ─── Result panel ─────────────────────────────────────────────────────────────

function ResultPanel({
  result, onDismiss, onApplyTags, applyingTags, tagsApplied,
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

  // Helper to render content (handles both bullet lists and plain text)
  function renderContent() {
    if (result.action === "tags") return null;

    const lines = result.content
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    // Check if content is a bullet list (starts with - or •)
    const isBulletList = lines.some(
      (l) => l.startsWith("-") || l.startsWith("•")
    );

    if (isBulletList) {
      // Render bullet points
      return lines
        .filter((l) => l.startsWith("-") || l.startsWith("•"))
        .map((line, i) => {
          const content = line.replace(/^[-•]\s*/, '');
          return (
            <div key={i} className="flex items-start gap-2 text-sm text-idemora-text-normal mb-1.5">
              <span className="text-blue-400 mt-0.5 shrink-0">•</span>
              <span className="leading-relaxed">{content}</span>
            </div>
          );
        });
    }

    // Render plain paragraphs (for explain action)
    return lines.map((line, i) => (
      <p key={i} className="text-sm text-idemora-text-normal leading-relaxed mb-2 last:mb-0">
        {line}
      </p>
    ));
  }

  return (
    <div className="absolute top-12 right-3 z-30 w-80 rounded-xl border-idemora-border  bg-idemora-bg-primary shadow-xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3.5 py-2.5 border-b  border-idemora-border">
        <div className="flex items-center gap-2">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M6 1v2M6 9v2M1 6h2M9 6h2M2.5 2.5l1.5 1.5M8 8l1.5 1.5M9.5 2.5L8 4M4 8L2.5 9.5"
              stroke="#3b82f6" strokeWidth="1.3" strokeLinecap="round" />
          </svg>
          <span className="text-xs font-semibold text-idemora-text-normal">
            {labels[result.action]}
          </span>
        </div>
        <button
          onClick={onDismiss}
          className="w-5 h-5 flex items-center justify-center rounded text-idemora-text-muted     transition-colors"
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
            <p className="text-xs text-idemora-text-muted">Click to select</p>
            <div className="flex flex-wrap gap-1.5">
              {result.tags.map((tag) => (
                <button
                  key={tag}
                  onClick={() => toggleTag(tag)}
                  className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border transition-colors duration-100 ${
                    selectedTags.includes(tag)
                      ? "bg-blue-50 /30 text-blue-600  border-blue-300 "
                      : "bg-idemora-bg-primary  text-idemora-text-muted border-idemora-border "
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
                  ? "bg-green-50 /30 text-green-600  border-green-200 "
                  : "bg-blue-500  text-idemora-text-normal disabled:opacity-40 disabled:cursor-not-allowed"
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
            {renderContent()}
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
  const enabled          = useAIStore((s) => s.enabled);
  const connectionStatus = useAIStore((s) => s.connectionStatus);
  const updateNote       = useNoteStore((s) => s.updateNote);
  const allNotes         = useNoteStore((s) => s.notes);

  const [loadingAction, setLoadingAction] = useState<ActionType | null>(null);
  const [result, setResult]               = useState<AIResult | null>(null);
  const [error, setError]                 = useState<string | null>(null);
  const [applyingTags, setApplyingTags]   = useState(false);
  const [tagsApplied, setTagsApplied]     = useState(false);

useEffect(() => {
  function handle(e: Event) {
    const { action } = (e as CustomEvent<{ action: ActionType }>).detail;
    runAction(action);
  }
  window.addEventListener("idemora:ai-action", handle);
  return () => window.removeEventListener("idemora:ai-action", handle);
}, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!enabled || connectionStatus !== "connected") return null;

  function dismiss() {
    setResult(null);
    setError(null);
    setTagsApplied(false);
  }

  async function runAction(action: ActionType) {
    if (result?.action === action) { dismiss(); return; }

    setLoadingAction(action);
    setError(null);
    setResult(null);
    setTagsApplied(false);

    try {
      // ── Check cache first ──────────────────────────────────────────────
      const cached = getCached(note, action);
      if (cached) {
        setResult({ action, content: cached.content, tags: cached.tags });
        setLoadingAction(null);
        return;
      }

      // ── Call AI ────────────────────────────────────────────────────────
      if (action === "summarize") {
        const { summary } = await summarizeNote(note, allNotes);
        setCached(note, action, { content: summary, cachedAt: Date.now() });
        setResult({ action, content: summary });
      } else if (action === "tags") {
        const { tags } = await generateTags(note, allNotes);
        setCached(note, action, { content: "", tags, cachedAt: Date.now() });
        setResult({ action, content: "", tags });
      } else if (action === "explain") {
        const { explanation } = await explainNote(note, allNotes);
        setCached(note, action, { content: explanation, cachedAt: Date.now() });
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
      <div className="flex items-center gap-1.5">
        <div className="w-px h-4 bg-idemora-bg-primary  mx-0.5" />

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
        <div className="absolute top-12 right-3 z-30 flex items-center gap-2 px-3 py-2 rounded-lg bg-red-50 /30 border-red-200  text-xs text-red-600  shadow-lg">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.2" />
            <path d="M6 4v2.5M6 8h.01" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
          {error}
          <button onClick={() => setError(null)} className="ml-1 ">✕</button>
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