// src/features/editor/components/Editor/StatusBar.tsx
import { useUIStore } from "@/features/ui/store/useUIStore";
import { useNoteStore } from "@/features/notes/store/useNoteStore";
import { SUPPORTED_LANGUAGES } from "./constants";
import type { Editor } from "@tiptap/react";

interface Props {
  editor: Editor | null;
  codeBlockLang: string | null;
  onLanguageChange: (lang: string) => void;
}

export function StatusBar({ editor, codeBlockLang, onLanguageChange }: Props) {
  const saveStatus          = useUIStore((s) => s.saveStatus);
  const openVersionHistory  = useUIStore((s) => s.openVersionHistory);
  const versionHistoryOpen  = useUIStore((s) => s.versionHistoryOpen);
  const closeVersionHistory = useUIStore((s) => s.closeVersionHistory);
  const activeNote          = useNoteStore((s) => s.activeNote());

  const wordCount = editor ? editor.getText().split(/\s+/).filter((w) => w.length > 0).length : 0;
  const charCount = editor ? editor.getText().length : 0;

  // Label shown on the picker when a language is active
  const currentLang = SUPPORTED_LANGUAGES.find((l) => l.value === (codeBlockLang ?? ""));
  const langLabel   = currentLang?.value ? currentLang.label : "Plain";

  return (
    <div className="flex items-center justify-between px-6 py-1.5 shrink-0 border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 text-[11px] text-zinc-400 dark:text-zinc-500 select-none">

      {/* Left — word / char counts + language picker when inside a code block */}
      <div className="flex items-center gap-3">
        <span>{wordCount} {wordCount === 1 ? "word" : "words"}</span>
        <span className="text-zinc-300 dark:text-zinc-700">·</span>
        <span>{charCount} {charCount === 1 ? "char" : "chars"}</span>

        {codeBlockLang !== null && (
          <>
            <span className="text-zinc-300 dark:text-zinc-700">·</span>
            <div className="relative flex items-center">
              {/* Visible label */}
              <span className="font-mono pointer-events-none">{langLabel}</span>
              {/* Invisible <select> overlaid on top — native dropdown, zero custom styling needed */}
              <select
                value={codeBlockLang}
                onChange={(e) => onLanguageChange(e.target.value)}
                className="absolute inset-0 opacity-0 cursor-pointer w-full"
                title="Set code block language"
              >
                {SUPPORTED_LANGUAGES.map((l) => (
                  <option key={l.value} value={l.value}>{l.label}</option>
                ))}
              </select>
            </div>
            {/* Small chevron to signal it's clickable */}
            <svg width="8" height="8" viewBox="0 0 8 8" fill="none" className="-ml-2 pointer-events-none">
              <path d="M1.5 3L4 5.5L6.5 3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </>
        )}
      </div>

      {/* Right — save status + history */}
      <div className="flex items-center gap-4">
        <span className={`flex items-center gap-1.5 transition-opacity duration-200 ${saveStatus === "idle" ? "opacity-0" : "opacity-100"}`}>
          {saveStatus === "saving" && (<><span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />Saving…</>)}
          {saveStatus === "saved"  && (<><span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />Saved</>)}
          {saveStatus === "error"  && (<><span className="w-1.5 h-1.5 rounded-full bg-red-400" />Save failed</>)}
        </span>
        {activeNote && (
          <button
            onClick={versionHistoryOpen ? closeVersionHistory : openVersionHistory}
            className="hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors duration-100"
            title="Version history"
          >
            History
          </button>
        )}
      </div>

    </div>
  );
}