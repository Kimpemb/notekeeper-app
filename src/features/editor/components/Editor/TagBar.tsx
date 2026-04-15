// src/features/editor/components/Editor/TagBar.tsx
import { useState, useRef, useEffect } from "react";
import { useNoteStore } from "@/features/notes/store/useNoteStore";
import { getAllTags } from "@/features/notes/db/queries";

interface Props {
  noteId: string;
  tags: string | null;
}

export function TagBar({ noteId, tags }: Props) {
  const updateNote = useNoteStore((s) => s.updateNote);

  const parsed: string[] = (() => {
    if (!tags) return [];
    try { return JSON.parse(tags) as string[]; }
    catch { return []; }
  })();

  const [input, setInput] = useState("");
  const [focused, setFocused] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [allTags, setAllTags] = useState<string[]>([]);
  const [selectedSug, setSelectedSug] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    getAllTags().then(setAllTags).catch(console.error);
  }, [tags]);

  useEffect(() => {
    if (!input.trim()) { setSuggestions([]); return; }
    const lower = input.toLowerCase();
    const filtered = allTags.filter(
      (t) => t.toLowerCase().includes(lower) && !parsed.includes(t)
    );
    setSuggestions(filtered.slice(0, 6));
    setSelectedSug(0);
  }, [input, allTags]);

  async function addTag(tag: string) {
    const trimmed = tag.trim().toLowerCase().replace(/\s+/g, "-");
    if (!trimmed || parsed.includes(trimmed)) { setInput(""); return; }
    const next = [...parsed, trimmed];
    await updateNote(noteId, { tags: JSON.stringify(next) });
    setInput("");
    setSuggestions([]);
  }

  async function removeTag(tag: string) {
    const next = parsed.filter((t) => t !== tag);
    await updateNote(noteId, { tags: next.length ? JSON.stringify(next) : null });
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      if (suggestions.length > 0 && input.trim()) {
        addTag(suggestions[selectedSug] ?? input);
      } else {
        addTag(input);
      }
    }
    if (e.key === "ArrowDown") { e.preventDefault(); setSelectedSug((s) => Math.min(s + 1, suggestions.length - 1)); }
    if (e.key === "ArrowUp")   { e.preventDefault(); setSelectedSug((s) => Math.max(s - 1, 0)); }
    if (e.key === "Backspace" && input === "" && parsed.length > 0) {
      removeTag(parsed[parsed.length - 1]);
    }
    if (e.key === "Escape") { setInput(""); setSuggestions([]); inputRef.current?.blur(); }
  }

  const showSuggestions = focused && suggestions.length > 0;

  return (
    <div className="relative flex flex-wrap items-center gap-1.5 mb-4 min-h-[24px]">
      {/* Existing tags */}
      {parsed.map((tag) => (
        <span
          key={tag}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-idemora-bg-primary text-idemora-text-muted border border-idemora-border group cursor-pointer hover:bg-black/[0.06] dark:hover:bg-white/[0.07] transition-colors duration-150"
        >
          <span className="opacity-50">#</span>
          <span>{tag}</span>
          <button
            onClick={() => removeTag(tag)}
            className="ml-0.5 opacity-0 group-hover:opacity-100 transition-opacity duration-100 leading-none"
            tabIndex={-1}
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
            </svg>
          </button>
        </span>
      ))}

      {/* Input */}
      <div className="relative">
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => setFocused(true)}
          onBlur={() => { setTimeout(() => { setFocused(false); setSuggestions([]); }, 150); }}
          placeholder={parsed.length === 0 ? "Add tags…" : "+"}
          className="h-6 text-xs bg-transparent outline-none text-idemora-text-muted placeholder-idemora-text-faint w-20 focus:w-32 transition-[width] duration-150 rounded hover:bg-black/[0.06] dark:hover:bg-white/[0.07] px-1"
          style={{ minWidth: parsed.length === 0 ? "80px" : "24px" }}
        />

        {/* Suggestions dropdown */}
        {showSuggestions && (
          <div className="absolute top-full left-0 mt-1 z-50 min-w-[140px] py-1 rounded-lg shadow-xl bg-idemora-bg-primary border border-idemora-border">
            {suggestions.map((s, i) => (
              <button
                key={s}
                onMouseDown={(e) => { e.preventDefault(); addTag(s); }}
                className={`w-full text-left px-3 py-1.5 text-xs transition-colors duration-75 ${
                  i === selectedSug 
                    ? "bg-blue-500/10 text-blue-400" 
                    : "text-idemora-text-muted hover:bg-black/[0.06] dark:hover:bg-white/[0.07]"
                }`}
              >
                <span className="opacity-50">#</span>{s}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}