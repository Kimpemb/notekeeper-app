// src/features/ui/components/KeyboardShortcuts.tsx

import { useEffect, useRef } from "react";
import { useUIStore } from "@/features/ui/store/useUIStore";
import { SHORTCUT_GROUPS } from "@/lib/keybindings";
import type { ShortcutGroup, Shortcut } from "@/lib/keybindings";

export function KeyboardShortcuts() {
  const shortcutsOpen  = useUIStore((s) => s.shortcutsOpen);
  const closeShortcuts = useUIStore((s) => s.closeShortcuts);
  const panelRef       = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!shortcutsOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") { e.preventDefault(); closeShortcuts(); }
    }
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [shortcutsOpen, closeShortcuts]);

  useEffect(() => {
    if (!shortcutsOpen) return;
    function onMouseDown(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) closeShortcuts();
    }
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [shortcutsOpen, closeShortcuts]);

  if (!shortcutsOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/20 dark:bg-black/40" />
      <div
        ref={panelRef}
        className="relative w-full max-w-lg mx-4 rounded-xl overflow-hidden bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 shadow-2xl"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-100 dark:border-zinc-800">
          <h2 className="text-base font-semibold text-zinc-800 dark:text-zinc-200">
            Keyboard Shortcuts
          </h2>
          <button
            onClick={closeShortcuts}
            className="w-7 h-7 flex items-center justify-center rounded-md text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors duration-150"
          >
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
              <path d="M1 1l11 11M12 1L1 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="overflow-y-auto max-h-[65vh] px-5 py-4 space-y-5">
          {SHORTCUT_GROUPS.map((group: ShortcutGroup) => (
            <div key={group.title}>
              <p className="text-xs font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500 mb-2">
                {group.title}
              </p>
              <div className="space-y-1">
                {group.shortcuts.map((s: Shortcut) => (
                  <div key={s.label} className="flex items-center justify-between py-1.5">
                    <span className="text-sm text-zinc-600 dark:text-zinc-400">{s.label}</span>
                    <div className="flex items-center gap-1">
                      {s.keys.map((key: string, i: number) => (
                        <kbd
                          key={i}
                          className="inline-flex items-center justify-center min-w-6.5 h-6.5 px-1.5 text-xs font-mono text-zinc-600 dark:text-zinc-400 bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-md shadow-sm"
                        >
                          {key}
                        </kbd>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="px-5 py-3 border-t border-zinc-100 dark:border-zinc-800">
          <p className="text-xs text-zinc-400 dark:text-zinc-600 text-center">
            Press{" "}
            <kbd className="font-mono text-xs bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 rounded border border-zinc-200 dark:border-zinc-700">
              Esc
            </kbd>{" "}
            to close
          </p>
        </div>
      </div>
    </div>
  );
}