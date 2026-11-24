// src/features/ui/components/EmptyState.tsx
import { useEffect, useRef, useState } from "react";
import { useNoteStore } from "@/features/notes/store/useNoteStore";
import { useUIStore } from "@/features/ui/store/useUIStore";
import { armBodyFocus } from "@/features/ui/lib/bodyFocusIntent";

interface Props {
  paneId: 1 | 2;
}

function Kbd({ children }: { children: string }) {
  return (
    <kbd className="px-1.5 py-0.5 rounded border border-idemora-border bg-idemora-bg-secondary font-mono text-[11px] text-idemora-text-muted">
      {children}
    </kbd>
  );
}

// Shown when a pane has no tabs. Looks like a blank note: type a title, press Enter.
export function EmptyState({ paneId }: Props) {
  const createNote = useNoteStore((s) => s.createNote);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

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
    if (busy) return;
    const name = title.trim();
    setBusy(true);
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

  return (
    <div
      className="flex-1 overflow-y-auto select-none"
      onClick={(e) => { if (e.target !== inputRef.current) inputRef.current?.focus(); }}
    >
      <div className="w-full mx-auto pl-16 pr-8 pt-[60px] pb-6 max-w-4xl xl:max-w-240 2xl:max-w-5xl">
        <input
          ref={inputRef}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={handleKeyDown}
          readOnly={busy}
          maxLength={80}
          placeholder="Untitled"
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="off"
          className="block w-full bg-transparent select-text font-bold outline-none text-idemora-text-normal placeholder:text-idemora-text-faint"
          style={{ fontSize: "3rem", lineHeight: 1.2 }}
        />
        <p className="mt-3 text-xs text-idemora-text-faint">
          Type a title and press <Kbd>Enter</Kbd> to create a note, or <Kbd>Esc</Kbd> to clear.
        </p>
        <p className="mt-1.5 text-xs text-idemora-text-faint">
          <Kbd>Ctrl</Kbd> <Kbd>N</Kbd> new note &middot; <Kbd>Ctrl</Kbd> <Kbd>Alt</Kbd> <Kbd>N</Kbd> notepad
        </p>
      </div>
    </div>
  );
}