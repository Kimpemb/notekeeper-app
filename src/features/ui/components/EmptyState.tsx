// src/features/ui/components/EmptyState.tsx
import { useEffect, useRef, useState } from "react";
import { useNoteStore } from "@/features/notes/store/useNoteStore";
import { useUIStore } from "@/features/ui/store/useUIStore";
import { armBodyFocus } from "@/features/ui/lib/bodyFocusIntent";
import {
  cancelBlankHandoff,
  startBlankHandoff,
  useBlankHandoff,
  type HandoffPhase,
} from "@/features/ui/lib/blankHandoff";

interface Props {
  paneId: 1 | 2;
  hasTabs: boolean;
}

function Kbd({ children }: { children: string }) {
  return (
    <kbd className="px-1.5 py-0.5 rounded border border-idemora-border bg-idemora-bg-secondary font-mono text-[11px] text-idemora-text-muted">
      {children}
    </kbd>
  );
}

// Always mounted by App. Visible when the pane has no tabs, and also while the
// new note's editor mounts underneath it (hand-off), so there is no blink.
export function EmptyState({ paneId, hasTabs }: Props) {
  const phase = useBlankHandoff(paneId);
  if (hasTabs && phase === "idle") return null;
  return <BlankPage paneId={paneId} phase={phase} />;
}

// Looks like a blank note: type a title, press Enter.
function BlankPage({ paneId, phase }: { paneId: 1 | 2; phase: HandoffPhase }) {
  const createNote = useNoteStore((s) => s.createNote);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  const isMyPane = () => useUIStore.getState().activePaneId === paneId;

  // Focus on mount, unless the sidebar has focus (its keys ignore inputs).
  useEffect(() => {
    if (!isMyPane()) return;
    const sidebar = document.getElementById("sidebar-panel");
    if (sidebar && sidebar.contains(document.activeElement)) return;
    inputRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Type anywhere: a printable key with nothing focused starts the title.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (phaseRef.current !== "idle") return;
      if (e.ctrlKey || e.metaKey || e.altKey || e.key.length !== 1) return;
      if (document.activeElement !== document.body) return;
      if (!isMyPane()) return;
      inputRef.current?.focus();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function create() {
    if (busy || phase !== "idle") return;
    const name = title.trim();
    setBusy(true);
    startBlankHandoff(paneId);
    try {
      useUIStore.getState().setActivePaneId(paneId);
      if (name) {
        armBodyFocus();
        await createNote({ title: name });
      } else {
        await createNote();
      }
    } catch (err) {
      console.error("Failed to create note:", err);
      cancelBlankHandoff();
    } finally {
      setBusy(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && !e.nativeEvent.isComposing) {
      e.preventDefault();
      create();
    } else if (e.key === "Escape") {
      setTitle("");
    }
  }

  // The rows below mirror the real editor column (Editor/index.tsx, FrontmatterEditor,
  // LastEdited, TagBar) class for class, so heights match exactly. If those change,
  // update the ghost rows too. Measured: title top = nav 36 + py-6 24 + frontmatter 32.
  return (
    <div
      className={`absolute inset-0 z-10 flex flex-col select-none bg-idemora-bg-primary transition-opacity duration-150 ${
        phase === "fading" ? "opacity-0 pointer-events-none" : ""
      }`}
      onClick={(e) => {
        if (phase !== "idle") return;
        if (e.target !== inputRef.current) inputRef.current?.focus();
      }}
    >
      {/* Same height as the editor's nav bar (h-9) */}
      <div aria-hidden className="h-9 shrink-0" />
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="w-full mx-auto pl-16 pr-8 py-6 min-h-full max-w-4xl xl:max-w-240 2xl:max-w-5xl">
          {/* Ghost of FrontmatterEditor's empty state */}
          <div aria-hidden className="mb-4 pointer-events-none">
            <div className="flex items-center gap-1.5 text-xs text-idemora-text-muted">
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                <path d="M5 1v8M1 5h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
              Add frontmatter
            </div>
          </div>
          <input
            ref={inputRef}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={handleKeyDown}
            readOnly={busy || phase !== "idle"}
            maxLength={80}
            placeholder="Untitled"
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="off"
            className="block w-full bg-transparent select-text font-bold outline-none text-idemora-text-normal placeholder:text-idemora-text-faint"
            style={{ fontSize: "3rem", lineHeight: 1.2 }}
          />
          {/* Ghost of LastEdited */}
          <div aria-hidden className="flex items-center gap-1.5 text-xs text-idemora-text-muted mb-4">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="opacity-60">
              <circle cx="6" cy="6" r="5" stroke="currentColor" strokeWidth="1.2" />
              <polyline points="6 3 6 6 8 8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span>Edited just now</span>
          </div>
          {/* Ghost of TagBar (same input-in-div structure, so it is 26px tall like the real one) */}
          <div aria-hidden className="relative flex flex-wrap items-center gap-1.5 mb-4 min-h-[24px] pointer-events-none">
            <div className="relative">
              <input
                readOnly
                tabIndex={-1}
                placeholder="Add tags…"
                className="h-6 text-xs bg-transparent outline-none text-idemora-text-muted placeholder-idemora-text-faint w-20 rounded px-1"
                style={{ minWidth: "80px" }}
              />
            </div>
          </div>
          {/* Body: same wrapper shape as the editor (60vh content + 25vh spacer = 85vh) */}
          <div>
            <div
              className="min-h-[60vh] text-idemora-text-faint"
              style={{
                fontFamily: "var(--editor-font-family)",
                fontSize: "var(--editor-font-size)",
                lineHeight: "var(--editor-line-height)",
              }}
            >
              <div>
                Press <Kbd>Enter</Kbd> to start writing, or <Kbd>Esc</Kbd> to clear the title.
              </div>
              <div className="text-xs">
                <Kbd>Ctrl</Kbd> <Kbd>N</Kbd> new note &middot; <Kbd>Ctrl</Kbd> <Kbd>Alt</Kbd> <Kbd>N</Kbd> notepad
              </div>
            </div>
            <div className="h-[25vh]" />
          </div>
        </div>
      </div>
    </div>
  );
}