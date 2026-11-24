// src/features/editor/components/Editor/FindReplace.tsx
import { useEffect, useRef, useState, useCallback } from "react";
import type { Editor } from "@tiptap/react";
import { Plugin, PluginKey, Selection } from "@tiptap/pm/state";
import { DecorationSet, Decoration } from "@tiptap/pm/view";
import { revealPosition } from "./editorUtils";

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
export interface FindOptions {
  caseSensitive: boolean;
  wholeWord: boolean;
  useRegex: boolean;
}

interface FindMatch {
  from: number;
  to: number;
  groups: string[];
}

// Returns null when the pattern is not a valid regular expression
function buildRegex(term: string, opts: FindOptions): RegExp | null {
  try {
    const flags = opts.caseSensitive ? "g" : "gi";
    let source = opts.useRegex ? term : term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (opts.wholeWord) {
      if (opts.useRegex) {
        source = `\\b(?:${source})\\b`;
      } else {
        // Only anchor on sides where the term itself starts/ends with a word character
        const start = /^\w/.test(term) ? "\\b" : "";
        const end = /\w$/.test(term) ? "\\b" : "";
        source = `${start}${source}${end}`;
      }
    }
    return new RegExp(source, flags);
  } catch {
    return null;
  }
}

// In regex mode the Replace field supports $1, $2 ... and $& ($$ is a literal $)
function expandReplacement(m: FindMatch, replaceText: string, useRegex: boolean): string {
  if (!useRegex) return replaceText;
  return replaceText.replace(/\$(\d+|&|\$)/g, (_, k: string) =>
    k === "$" ? "$" : k === "&" ? m.groups[0] : (m.groups[Number(k)] ?? "")
  );
}

function computeMatches(
  editor: Editor,
  term: string,
  opts: FindOptions,
  currentIndex: number
): { matches: FindMatch[]; decorations: DecorationSet; invalid: boolean } {
  const doc = editor.state.doc;
  if (!term) return { matches: [], decorations: DecorationSet.empty, invalid: false };

  const regex = buildRegex(term, opts);
  if (!regex) return { matches: [], decorations: DecorationSet.empty, invalid: true };

  const matches: FindMatch[] = [];

  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return;
    let m: RegExpExecArray | null;
    regex.lastIndex = 0;
    while ((m = regex.exec(node.text)) !== null) {
      // Skip empty matches (for example the regex a*) so the loop always advances
      if (m[0].length === 0) { regex.lastIndex++; continue; }
      matches.push({ from: pos + m.index, to: pos + m.index + m[0].length, groups: Array.from(m) });
    }
  });

  const decorations = matches.map((m, i) =>
    Decoration.inline(m.from, m.to, {
      class: i === currentIndex
        ? "find-replace-current"
        : "find-replace-match",
    })
  );

  return { matches, decorations: DecorationSet.create(doc, decorations), invalid: false };
}

function applyToEditor(
  editor: Editor,
  term: string,
  opts: FindOptions,
  currentIndex: number
): { matches: FindMatch[]; invalid: boolean } {
  const { matches, decorations, invalid } = computeMatches(editor, term, opts, currentIndex);
  const tr = editor.state.tr.setMeta(findReplaceKey, {
    decorations,
    matches: matches.map(({ from, to }) => ({ from, to })),
    currentIndex,
  });
  editor.view.dispatch(tr);
  return { matches, invalid };
}

// ---------------------------------------------------------------------------
// FindReplace component
// ---------------------------------------------------------------------------
interface Props {
  editor: Editor;
  onClose: () => void;
  focusSignal?: number;
  focusTarget?: "find" | "replace";
}

export function FindReplace({ editor, onClose, focusSignal = 0, focusTarget = "find" }: Props) {
  const [findText, setFindText]       = useState("");
  const [replaceText, setReplaceText] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord]         = useState(false);
  const [useRegex, setUseRegex]           = useState(false);
  const [invalid, setInvalid]             = useState(false);
  const [currentIndex, setCurrentIndex]  = useState(0);
  const [matchCount, setMatchCount]      = useState(0);

  const findInputRef = useRef<HTMLInputElement>(null);
  const replaceInputRef = useRef<HTMLInputElement>(null);
  const matchesRef   = useRef<FindMatch[]>([]);
  const opts: FindOptions = { caseSensitive, wholeWord, useRegex };

  // Focus and select the find input on mount and every time Ctrl+F is pressed again
  useEffect(() => {
    const t = setTimeout(() => {
      const el = focusTarget === "replace" ? replaceInputRef.current : findInputRef.current;
      el?.focus();
      el?.select();
    }, 0);
    return () => clearTimeout(t);
  }, [focusSignal]);

  // Recompute matches whenever find text, case sensitivity, or doc changes
  const refresh = useCallback((term: string, o: FindOptions, idx: number) => {
    const { matches, invalid: bad } = applyToEditor(editor, term, o, idx);
    matchesRef.current = matches;
    setMatchCount(matches.length);
    setInvalid(bad);
    return matches;
  }, [editor]);

  useEffect(() => {
    const clamped = matchCount > 0 ? Math.min(currentIndex, matchCount - 1) : 0;
    refresh(findText, opts, clamped);
  }, [findText, caseSensitive, wholeWord, useRegex]); // eslint-disable-line react-hooks/exhaustive-deps

  // Scroll editor to current match
  function scrollToCurrent(idx: number) {
    const match = matchesRef.current[idx];
    if (!match) return;
    const doScroll = () => {
      const coords = editor.view.coordsAtPos(match.from);
      const editorEl = editor.view.dom.closest(".overflow-y-auto");
      if (editorEl) {
        editorEl.scrollTo({ top: editorEl.scrollTop + coords.top - editorEl.getBoundingClientRect().top - 120, behavior: "smooth" });
      }
    };
    if (revealPosition(editor, match.from)) setTimeout(doScroll, 60); else doScroll();
  }

  function goToIndex(idx: number) {
    if (matchesRef.current.length === 0) return;
    const clamped = ((idx % matchesRef.current.length) + matchesRef.current.length) % matchesRef.current.length;
    setCurrentIndex(clamped);
    refresh(findText, opts, clamped);
    scrollToCurrent(clamped);
  }

  function handleNext() { goToIndex(currentIndex + 1); }
  function handlePrev() { goToIndex(currentIndex - 1); }

  function handleReplace() {
    if (matchesRef.current.length === 0 || !findText) return;
    const match = matchesRef.current[currentIndex];
    if (!match) return;
    const text = expandReplacement(match, replaceText, useRegex);
    editor.view.dispatch(editor.state.tr.insertText(text, match.from, match.to));
    // Recompute on the edited doc, then step to the first match after the inserted text
    const after = refresh(findText, opts, 0);
    if (after.length === 0) { setCurrentIndex(0); return; }
    const insertedEnd = match.from + text.length;
    let next = after.findIndex((m) => m.from >= insertedEnd);
    if (next === -1) next = 0; // wrap around
    refresh(findText, opts, next);
    setCurrentIndex(next);
    scrollToCurrent(next);
  }

  function handleReplaceAll() {
    if (matchesRef.current.length === 0 || !findText) return;
    const tr = editor.state.tr;
    // End to start so earlier positions stay valid; one transaction = one undo step
    for (const match of [...matchesRef.current].reverse()) {
      tr.insertText(expandReplacement(match, replaceText, useRegex), match.from, match.to);
    }
    editor.view.dispatch(tr);
    refresh(findText, opts, 0);
    setCurrentIndex(0);
  }

  function handleClose() {
    // Remember where the user is reading so closing the bar never moves the page
    const scroller = editor.view.dom.closest(".overflow-y-auto") as HTMLElement | null;
    const savedTop = scroller?.scrollTop ?? 0;

    // Pick a collapsed caret: the match being looked at (read from the plugin so its
    // positions are mapped through any edits), otherwise the start of the old selection.
    // Never leave a range selected, and never fall back to doc end (AllSelection.head).
    const pluginState = findReplaceKey.getState(editor.state);
    const match = findText ? pluginState?.matches[currentIndex] : undefined;
    const docSize = editor.state.doc.content.size;
    const caretPos = Math.min(match ? match.from : editor.state.selection.from, docSize);

    // Clear all decorations and collapse the selection in one transaction (no scrollIntoView)
    const tr = editor.state.tr.setMeta(findReplaceKey, {
      decorations: DecorationSet.empty,
      matches: [],
      currentIndex: -1,
    });
    tr.setSelection(Selection.near(tr.doc.resolve(caretPos)));
    editor.view.dispatch(tr);
    onClose();

    // Give focus back to the editor without scrolling, then undo any layout-shift scroll
    // caused by the bar unmounting.
    editor.commands.focus(null, { scrollIntoView: false });
    if (scroller) {
      requestAnimationFrame(() => requestAnimationFrame(() => {
        scroller.scrollTo({ top: savedTop, behavior: "instant" as ScrollBehavior });
      }));
    }
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
    <div className="flex items-start gap-1.5 px-3 py-2 border-b border-idemora-border bg-idemora-bg-primary shrink-0">
      <div className="flex items-center gap-1.5 flex-wrap min-w-0 flex-1">

      {/* Find input + counter */}
      <div className="flex items-center gap-1 min-w-0">
        <div className="relative flex items-center">
          <input
            ref={findInputRef}
            value={findText}
            onChange={(e) => { setFindText(e.target.value); setCurrentIndex(0); }}
            onKeyDown={handleFindKeyDown}
            placeholder="Find…"
            spellCheck={false}
            className="h-7 pl-2.5 pr-16 rounded-md text-sm bg-idemora-bg-primary border border-idemora-border text-idemora-text-normal placeholder-idemora-text-muted outline-none focus:ring-2 focus:ring-blue-500 w-[148px] transition-colors duration-150"
          />
          {/* Match counter */}
          <span className="absolute right-2 text-xs text-idemora-text-muted pointer-events-none tabular-nums">
            {findText ? (invalid ? "invalid" : `${displayIndex}/${matchCount}`) : ""}
          </span>
        </div>

        {/* Case sensitive toggle */}
        <button
          onClick={() => setCaseSensitive((c) => !c)}
          title="Case sensitive"
          className={`h-7 px-1.5 rounded-md text-xs font-mono transition-colors duration-150 border ${
            caseSensitive
              ? "bg-blue-500/10 text-blue-400 border-blue-500/20"
              : "bg-idemora-bg-primary text-idemora-text-muted border-idemora-border"
          }`}
        >
          Aa
        </button>

        {/* Whole word toggle */}
        <button
          onClick={() => setWholeWord((w) => !w)}
          title="Whole word"
          className={`h-7 px-1.5 rounded-md text-xs font-mono transition-colors duration-150 border ${
            wholeWord
              ? "bg-blue-500/10 text-blue-400 border-blue-500/20"
              : "bg-idemora-bg-primary text-idemora-text-muted border-idemora-border"
          }`}
        >
          <u>ab</u>
        </button>

        {/* Regex toggle */}
        <button
          onClick={() => setUseRegex((r) => !r)}
          title="Regular expression (use $1 in Replace for capture groups)"
          className={`h-7 px-1.5 rounded-md text-xs font-mono transition-colors duration-150 border ${
            useRegex
              ? "bg-blue-500/10 text-blue-400 border-blue-500/20"
              : "bg-idemora-bg-primary text-idemora-text-muted border-idemora-border"
          }`}
        >
          .*
        </button>

        {/* Prev / Next */}
        <button
          onClick={handlePrev}
          disabled={matchCount === 0}
          title="Previous match (Shift+Enter)"
          className="h-7 w-6 flex items-center justify-center rounded-md bg-idemora-bg-primary border border-idemora-border text-idemora-text-muted hover:text-idemora-text-normal disabled:opacity-30 transition-colors duration-150"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path d="M2 6.5L5 3.5L8 6.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
        <button
          onClick={handleNext}
          disabled={matchCount === 0}
          title="Next match (Enter)"
          className="h-7 w-6 flex items-center justify-center rounded-md bg-idemora-bg-primary border border-idemora-border text-idemora-text-muted hover:text-idemora-text-normal disabled:opacity-30 transition-colors duration-150"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
      </div>

      {/* Divider */}
      <div className="w-px h-4 bg-idemora-border shrink-0" />

      {/* Replace input + buttons */}
      <div className="flex items-center gap-1 min-w-0">
        <input
          ref={replaceInputRef}
          value={replaceText}
          onChange={(e) => setReplaceText(e.target.value)}
          onKeyDown={handleReplaceKeyDown}
          placeholder="Replace…"
          spellCheck={false}
          className="h-7 px-2.5 rounded-md text-sm bg-idemora-bg-primary border border-idemora-border text-idemora-text-normal placeholder-idemora-text-muted outline-none focus:ring-2 focus:ring-blue-500 w-28 transition-colors duration-150"
        />
        <button
          onClick={handleReplace}
          disabled={matchCount === 0 || !findText}
          className="h-7 px-2 rounded-md text-xs bg-idemora-bg-primary border border-idemora-border text-idemora-text-normal hover:bg-blue-500/10 hover:text-blue-400 disabled:opacity-30 transition-colors duration-150 shrink-0"
        >
          Replace
        </button>
        <button
          onClick={handleReplaceAll}
          disabled={matchCount === 0 || !findText}
          className="h-7 px-2 rounded-md text-xs bg-idemora-bg-primary border border-idemora-border text-idemora-text-normal hover:bg-blue-500/10 hover:text-blue-400 disabled:opacity-30 transition-colors duration-150 shrink-0"
        >
          Replace All
        </button>
      </div>
      </div>

      <button
        onClick={handleClose}
        title="Close (Escape)"
        className="ml-auto h-7 w-7 flex items-center justify-center rounded-md text-idemora-text-muted hover:text-idemora-text-normal hover:bg-idemora-bg-secondary transition-colors duration-150 shrink-0"
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
        </svg>
      </button>
    </div>
  );
}