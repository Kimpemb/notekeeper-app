// src/features/editor/components/Editor/FindReplace.tsx
import { useEffect, useRef, useState, useCallback } from "react";
import type { Editor } from "@tiptap/react";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { DecorationSet, Decoration } from "@tiptap/pm/view";

// ---------------------------------------------------------------------------
// Decoration plugin — lives outside React, updated via plugin meta
// ---------------------------------------------------------------------------
export const findReplaceKey = new PluginKey<FindReplaceState>("findReplace");

interface FindReplaceState {
  decorations: DecorationSet;
  matches: { from: number; to: number }[];
  currentIndex: number;
}

export function buildFindReplacePlugin() {
  return new Plugin<FindReplaceState>({
    key: findReplaceKey,
    state: {
      init() {
        return { decorations: DecorationSet.empty, matches: [], currentIndex: -1 };
      },
      apply(tr, prev) {
        const meta = tr.getMeta(findReplaceKey) as Partial<FindReplaceState> | undefined;
        if (meta) {
          return {
            decorations: meta.decorations ?? prev.decorations,
            matches: meta.matches ?? prev.matches,
            currentIndex: meta.currentIndex ?? prev.currentIndex,
          };
        }
        // Remap decorations on doc change
        if (tr.docChanged) {
          return {
            ...prev,
            decorations: prev.decorations.map(tr.mapping, tr.doc),
            matches: prev.matches.map((m) => ({
              from: tr.mapping.map(m.from),
              to: tr.mapping.map(m.to),
            })),
          };
        }
        return prev;
      },
    },
    props: {
      decorations(state) {
        return findReplaceKey.getState(state)?.decorations ?? DecorationSet.empty;
      },
    },
  });
}

// ---------------------------------------------------------------------------
// Helper — compute matches and decorations from a search term
// ---------------------------------------------------------------------------
function computeMatches(
  editor: Editor,
  term: string,
  caseSensitive: boolean,
  currentIndex: number
): { matches: { from: number; to: number }[]; decorations: DecorationSet } {
  const doc = editor.state.doc;
  if (!term) return { matches: [], decorations: DecorationSet.empty };

  const matches: { from: number; to: number }[] = [];
  const flags = caseSensitive ? "g" : "gi";
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(escaped, flags);

  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return;
    let m: RegExpExecArray | null;
    regex.lastIndex = 0;
    while ((m = regex.exec(node.text)) !== null) {
      matches.push({ from: pos + m.index, to: pos + m.index + m[0].length });
    }
  });

  const decorations = matches.map((m, i) =>
    Decoration.inline(m.from, m.to, {
      class: i === currentIndex
        ? "find-replace-current"
        : "find-replace-match",
    })
  );

  return { matches, decorations: DecorationSet.create(doc, decorations) };
}

function applyToEditor(
  editor: Editor,
  term: string,
  caseSensitive: boolean,
  currentIndex: number
) {
  const { matches, decorations } = computeMatches(editor, term, caseSensitive, currentIndex);
  const tr = editor.state.tr.setMeta(findReplaceKey, {
    decorations,
    matches,
    currentIndex,
  });
  editor.view.dispatch(tr);
  return matches;
}

// ---------------------------------------------------------------------------
// FindReplace component
// ---------------------------------------------------------------------------
interface Props {
  editor: Editor;
  onClose: () => void;
}

export function FindReplace({ editor, onClose }: Props) {
  const [findText, setFindText]       = useState("");
  const [replaceText, setReplaceText] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [currentIndex, setCurrentIndex]  = useState(0);
  const [matchCount, setMatchCount]      = useState(0);

  const findInputRef = useRef<HTMLInputElement>(null);
  const matchesRef   = useRef<{ from: number; to: number }[]>([]);

  // Focus find input on mount
  useEffect(() => {
    setTimeout(() => findInputRef.current?.focus(), 0);
  }, []);

  // Recompute matches whenever find text, case sensitivity, or doc changes
  const refresh = useCallback((term: string, cs: boolean, idx: number) => {
    const matches = applyToEditor(editor, term, cs, idx);
    matchesRef.current = matches;
    setMatchCount(matches.length);
    return matches;
  }, [editor]);

  useEffect(() => {
    const clamped = matchCount > 0 ? Math.min(currentIndex, matchCount - 1) : 0;
    refresh(findText, caseSensitive, clamped);
  }, [findText, caseSensitive]); // eslint-disable-line react-hooks/exhaustive-deps

  // Scroll editor to current match
  function scrollToCurrent(idx: number) {
    const match = matchesRef.current[idx];
    if (!match) return;
    const coords = editor.view.coordsAtPos(match.from);
    const editorEl = editor.view.dom.closest(".overflow-y-auto");
    if (editorEl) {
      editorEl.scrollTo({ top: editorEl.scrollTop + coords.top - editorEl.getBoundingClientRect().top - 120, behavior: "smooth" });
    }
  }

  function goToIndex(idx: number) {
    if (matchesRef.current.length === 0) return;
    const clamped = ((idx % matchesRef.current.length) + matchesRef.current.length) % matchesRef.current.length;
    setCurrentIndex(clamped);
    refresh(findText, caseSensitive, clamped);
    scrollToCurrent(clamped);
  }

  function handleNext() { goToIndex(currentIndex + 1); }
  function handlePrev() { goToIndex(currentIndex - 1); }

  function handleReplace() {
    if (matchesRef.current.length === 0 || !findText) return;
    const match = matchesRef.current[currentIndex];
    if (!match) return;
    editor.chain()
      .focus()
      .deleteRange({ from: match.from, to: match.to })
      .insertContentAt(match.from, replaceText)
      .run();
    // Re-run after doc change
    const newMatches = refresh(findText, caseSensitive, currentIndex);
    const nextIdx = Math.min(currentIndex, newMatches.length - 1);
    setCurrentIndex(Math.max(0, nextIdx));
  }

  function handleReplaceAll() {
    if (matchesRef.current.length === 0 || !findText) return;
    // Replace from end to start so positions don't shift
    const sorted = [...matchesRef.current].reverse();
    let chain = editor.chain().focus();
    for (const match of sorted) {
      chain = chain.deleteRange({ from: match.from, to: match.to }).insertContentAt(match.from, replaceText) as typeof chain;
    }
    chain.run();
    refresh(findText, caseSensitive, 0);
    setCurrentIndex(0);
  }

  function handleClose() {
    // Clear all decorations
    const tr = editor.state.tr.setMeta(findReplaceKey, {
      decorations: DecorationSet.empty,
      matches: [],
      currentIndex: -1,
    });
    editor.view.dispatch(tr);
    onClose();
  }

  // Keyboard shortcuts inside the bar
  function handleFindKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") { e.preventDefault(); e.shiftKey ? handlePrev() : handleNext(); }
    if (e.key === "Escape") { e.preventDefault(); handleClose(); }
  }

  function handleReplaceKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") { e.preventDefault(); handleReplace(); }
    if (e.key === "Escape") { e.preventDefault(); handleClose(); }
  }

  const displayIndex = matchCount > 0 ? currentIndex + 1 : 0;

  return (
    <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 shrink-0 flex-wrap">

      {/* Find input + counter */}
      <div className="flex items-center gap-1.5 min-w-0">
        <div className="relative flex items-center">
          <input
            ref={findInputRef}
            value={findText}
            onChange={(e) => { setFindText(e.target.value); setCurrentIndex(0); }}
            onKeyDown={handleFindKeyDown}
            placeholder="Find…"
            spellCheck={false}
            className="h-7 pl-2.5 pr-16 rounded-md text-sm bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-600 text-zinc-800 dark:text-zinc-200 placeholder-zinc-400 dark:placeholder-zinc-500 outline-none focus:border-blue-400 dark:focus:border-blue-500 w-44 transition-colors duration-150"
          />
          {/* Match counter */}
          <span className="absolute right-2 text-xs text-zinc-400 dark:text-zinc-500 pointer-events-none tabular-nums">
            {findText ? `${displayIndex}/${matchCount}` : ""}
          </span>
        </div>

        {/* Case sensitive toggle */}
        <button
          onClick={() => setCaseSensitive((c) => !c)}
          title="Case sensitive"
          className={`h-7 px-2 rounded-md text-xs font-mono transition-colors duration-150 border ${
            caseSensitive
              ? "bg-blue-100 dark:bg-blue-950 text-blue-600 dark:text-blue-400 border-blue-300 dark:border-blue-700"
              : "bg-white dark:bg-zinc-800 text-zinc-400 dark:text-zinc-500 border-zinc-300 dark:border-zinc-600 hover:text-zinc-600 dark:hover:text-zinc-300"
          }`}
        >
          Aa
        </button>

        {/* Prev / Next */}
        <button
          onClick={handlePrev}
          disabled={matchCount === 0}
          title="Previous match (Shift+Enter)"
          className="h-7 w-7 flex items-center justify-center rounded-md bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-600 text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200 disabled:opacity-30 transition-colors duration-150"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path d="M2 6.5L5 3.5L8 6.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
        <button
          onClick={handleNext}
          disabled={matchCount === 0}
          title="Next match (Enter)"
          className="h-7 w-7 flex items-center justify-center rounded-md bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-600 text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200 disabled:opacity-30 transition-colors duration-150"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
      </div>

      {/* Divider */}
      <div className="w-px h-4 bg-zinc-200 dark:bg-zinc-700 shrink-0" />

      {/* Replace input + buttons */}
      <div className="flex items-center gap-1.5 min-w-0">
        <input
          value={replaceText}
          onChange={(e) => setReplaceText(e.target.value)}
          onKeyDown={handleReplaceKeyDown}
          placeholder="Replace…"
          spellCheck={false}
          className="h-7 px-2.5 rounded-md text-sm bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-600 text-zinc-800 dark:text-zinc-200 placeholder-zinc-400 dark:placeholder-zinc-500 outline-none focus:border-blue-400 dark:focus:border-blue-500 w-36 transition-colors duration-150"
        />
        <button
          onClick={handleReplace}
          disabled={matchCount === 0 || !findText}
          className="h-7 px-2.5 rounded-md text-xs bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-600 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-700 disabled:opacity-30 transition-colors duration-150 shrink-0"
        >
          Replace
        </button>
        <button
          onClick={handleReplaceAll}
          disabled={matchCount === 0 || !findText}
          className="h-7 px-2.5 rounded-md text-xs bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-600 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-700 disabled:opacity-30 transition-colors duration-150 shrink-0"
        >
          Replace All
        </button>
      </div>

      {/* Close */}
      <button
        onClick={handleClose}
        title="Close (Escape)"
        className="ml-auto h-7 w-7 flex items-center justify-center rounded-md text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors duration-150 shrink-0"
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
        </svg>
      </button>
    </div>
  );
}