// src/features/ui/components/TipsPanel.tsx
import { useEffect, useRef } from "react";
import { useUIStore } from "@/features/ui/store/useUIStore";

interface Tip {
  keys?: string[];
  action?: string;
  description: string;
}

interface Category {
  title: string;
  tips: Tip[];
}

const CATEGORIES: Category[] = [
  {
    title: "Navigation",
    tips: [
      { keys: ["Ctrl", "K"],           description: "Open command palette" },
      { keys: ["Ctrl", "["],           description: "Go back" },
      { keys: ["Ctrl", "]"],           description: "Go forward" },
      { keys: ["Ctrl", "Tab"],         description: "Cycle through tabs" },
      { keys: ["Ctrl", "\\"],          description: "Toggle sidebar" },
      { keys: ["Ctrl", "Shift", "?"],  description: "Keyboard shortcuts reference" },
    ],
  },
  {
    title: "Creating notes",
    tips: [
      { keys: ["Ctrl", "N"],           description: "New note in current tab" },
      { keys: ["Ctrl", "Shift", "N"],  description: "New note in a new tab" },
      { action: "Right-click note",    description: "New sub-note, rename, pin, move, or trash" },
      { action: "Daily note",          description: "Open today's daily note from the command palette" },
    ],
  },
  {
    title: "Editing",
    tips: [
      { action: "Type /",              description: "Open slash menu to insert blocks" },
      { action: "Type [[",             description: "Insert a wiki link to another note" },
      { action: "Select text",         description: "Bubble menu appears for bold, italic, code, and more" },
      { keys: ["Ctrl", "H"],           description: "Find and replace" },
      { keys: ["Ctrl", "Z"],           description: "Undo" },
    ],
  },
  {
    title: "Blocks",
    tips: [
      { keys: ["Mod", "Enter"],        description: "Open or close a toggle block" },
      { action: "Enter on empty line", description: "Exit a list, callout, or toggle body" },
      { action: "Backspace at start",  description: "Delete empty toggle or unwrap block" },
      { action: "Click callout icon",  description: "Change callout type (info, warning, tip, danger)" },
      { keys: ["Ctrl", "A"],           description: "Select all content within the current block" },
    ],
  },
  {
    title: "Tabs & split panes",
    tips: [
      { keys: ["Ctrl", "W"],           description: "Close active tab" },
      { action: "Middle-click tab",    description: "Close that tab" },
      { action: "Right-click tab",     description: "Open in new tab or open in split pane" },
      { action: "Right-click note",    description: "Open in split pane directly from sidebar" },
      { action: "Split divider",       description: "Toggle orientation, swap panes, or close split" },
    ],
  },
  {
    title: "Organisation",
    tips: [
      { action: "Drag note",           description: "Reorder notes in the sidebar" },
      { action: "Right-click → Pin",   description: "Pin a root note to the top of the sidebar" },
      { action: "Right-click → Move",  description: "Re-parent a note under a different note" },
      { keys: ["Ctrl", "T"],           description: "Toggle file tree panel" },
      { keys: ["Ctrl", ";"],           description: "Toggle backlinks panel" },
      { keys: ["Ctrl", "'"],           description: "Toggle outline panel" },
    ],
  },
];

function Key({ label }: { label: string }) {
  return (
    <kbd className="inline-flex items-center justify-center min-w-[1.4rem] h-5 px-1.5 rounded text-[10px] font-medium bg-zinc-100 dark:bg-zinc-700 text-zinc-500 dark:text-zinc-400 border border-zinc-300 dark:border-zinc-600 leading-none">
      {label}
    </kbd>
  );
}

export function TipsPanel() {
  const tipsOpen   = useUIStore((s) => s.tipsOpen);
  const closeTips  = useUIStore((s) => s.closeTips);
  const panelRef   = useRef<HTMLDivElement>(null);

  // Close on Escape
  useEffect(() => {
    if (!tipsOpen) return;
    function handle(e: KeyboardEvent) {
      if (e.key === "Escape") closeTips();
    }
    document.addEventListener("keydown", handle);
    return () => document.removeEventListener("keydown", handle);
  }, [tipsOpen, closeTips]);

  return (
    /*
      Slide-in from top using CSS transform + transition.
      The panel sits in normal document flow so it pushes the editor
      content down rather than overlapping it — feels more intentional
      than a floating overlay and fits the "slide down from header" direction.
    */
    <div
      ref={panelRef}
      style={{
        maxHeight: tipsOpen ? "380px" : "0px",
        opacity: tipsOpen ? 1 : 0,
        transition: "max-height 280ms cubic-bezier(0.4, 0, 0.2, 1), opacity 200ms ease",
        overflow: "hidden",
      }}
      aria-hidden={!tipsOpen}
    >
      <div className="border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950">
        {/* Header row */}
        <div className="flex items-center justify-between px-5 pt-3 pb-2">
          <span className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">
            Tips &amp; shortcuts
          </span>
          <button
            onClick={closeTips}
            className="w-6 h-6 flex items-center justify-center rounded text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors duration-100"
            aria-label="Close tips"
          >
            <svg width="10" height="10" viewBox="0 0 8 8" fill="none">
              <path d="M1 1l6 6M7 1L1 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </button>
        </div>

        {/* Categories scroll area */}
        <div
          className="overflow-x-auto pb-3 px-5"
          style={{ scrollbarWidth: "none" }}
        >
          <div className="flex gap-6 min-w-max">
            {CATEGORIES.map((cat) => (
              <div key={cat.title} className="w-52 shrink-0">
                <p className="text-[11px] font-semibold text-zinc-400 dark:text-zinc-500 uppercase tracking-wide mb-2">
                  {cat.title}
                </p>
                <div className="space-y-1.5">
                  {cat.tips.map((tip, i) => (
                    <div key={i} className="flex items-start gap-2">
                      <div className="flex items-center gap-0.5 shrink-0 min-w-[7rem]">
                        {tip.keys ? (
                          tip.keys.map((k, ki) => (
                            <span key={ki} className="flex items-center gap-0.5">
                              {ki > 0 && <span className="text-zinc-300 dark:text-zinc-600 text-[10px] mx-0.5">+</span>}
                              <Key label={k} />
                            </span>
                          ))
                        ) : (
                          <span className="text-[11px] text-zinc-500 dark:text-zinc-400 italic leading-tight">
                            {tip.action}
                          </span>
                        )}
                      </div>
                      <span className="text-[11px] text-zinc-500 dark:text-zinc-500 leading-tight pt-px">
                        {tip.description}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}