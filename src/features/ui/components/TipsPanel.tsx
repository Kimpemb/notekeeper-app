// src/features/ui/components/TipsPanel.tsx
import { useEffect, useRef } from "react";
import { useUIStore } from "@/features/ui/store/useUIStore";
import { useNoteStore } from "@/features/notes/store/useNoteStore";

interface Tip {
  keys?: string[];
  action?: string;
  description: string;
  category?: string;
}

function getTipAction(description: string, _keys?: string[]): (() => void) | undefined {
  const uiStore = useUIStore.getState();
  const noteStore = useNoteStore.getState();

  const actionMap: Record<string, () => void> = {
    "Open command palette": () => uiStore.togglePalette(),
    "New note": () => uiStore.openTemplatePicker(),
    "New note in new tab": () => window.dispatchEvent(new CustomEvent("idemora:new-note-new-tab")),
    "Toggle sidebar": () => uiStore.toggleSidebar(),
    "Toggle file tree": () => uiStore.toggleFileTree(uiStore.activePaneId),
    "Toggle graph view": () => uiStore.graphOpen ? uiStore.closeGraph() : uiStore.openGraph(),
    "Toggle tips panel": () => uiStore.toggleTips(),
    "Reload notes": () => {
      uiStore.setRefreshStatus("reloading");
      noteStore.loadNotes().then(() => uiStore.setRefreshStatus("reloaded"));
    },
    "Keyboard shortcuts": () => uiStore.openShortcuts(),
    "Close tab": () => uiStore.closeActiveTab(),
    "Next tab": () => uiStore.cycleTab(1),
    "Previous tab": () => uiStore.cycleTab(-1),
    "Reopen closed tab": () => uiStore.reopenClosedTab(),
    "Go back": () => noteStore.goBack(),
    "Go forward": () => noteStore.goForward(),
    "Bold": () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', ctrlKey: true, bubbles: true })),
    "Italic": () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'i', ctrlKey: true, bubbles: true })),
    "Strikethrough": () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, shiftKey: true, bubbles: true })),
    "Inline code": () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'e', ctrlKey: true, bubbles: true })),
    "Find & replace": () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'h', ctrlKey: true, bubbles: true })),
    "Undo": () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true })),
    "Redo": () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, shiftKey: true, bubbles: true })),
    "Toggle backlinks": () => uiStore.toggleBacklinks(uiStore.activePaneId),
    "Toggle outline": () => uiStore.toggleOutline(uiStore.activePaneId),
    "Open/close graph": () => uiStore.graphOpen ? uiStore.closeGraph() : uiStore.openGraph(),
    "Open today's note": () => noteStore.createOrOpenDailyNote(),
  };

  return actionMap[description];
}

const TIPS_BY_CATEGORY: { title: string; tips: Tip[] }[] = [
  {
    title: "Global",
    tips: [
      { keys: ["Ctrl", "K"],     description: "Open command palette" },
      { keys: ["Ctrl", "N"],     description: "New note" },
      { keys: ["Ctrl", "Shift", "N"], description: "New note in new tab" },
      { keys: ["Ctrl", "Shift", "E"], description: "Toggle tips panel" },
    ],
  },
  {
    title: "View",
    tips: [
      { keys: ["Ctrl", "\\"],    description: "Toggle sidebar" },
      { keys: ["Ctrl", "T"],     description: "Toggle file tree" },
      { keys: ["Ctrl", "Shift", "G"], description: "Toggle graph view" },
      { keys: ["Ctrl", "F"],     description: "Search notes" },
    ],
  },
  {
    title: "Tabs",
    tips: [
      { keys: ["Ctrl", "W"],     description: "Close tab" },
      { keys: ["Ctrl", "Tab"],   description: "Next tab" },
      { keys: ["Ctrl", "Shift", "Tab"], description: "Previous tab" },
      { keys: ["Ctrl", "Shift", "T"], description: "Reopen closed tab" },
    ],
  },
  {
    title: "Navigation",
    tips: [
      { keys: ["Ctrl", "["],     description: "Go back" },
      { keys: ["Ctrl", "]"],     description: "Go forward" },
      { keys: ["Ctrl", "Shift", "L"], description: "Reload notes" },
      { keys: ["Ctrl", "Shift", "?"], description: "Keyboard shortcuts" },
    ],
  },
  {
    title: "Formatting",
    tips: [
      { keys: ["Ctrl", "B"],     description: "Bold" },
      { keys: ["Ctrl", "I"],     description: "Italic" },
      { keys: ["Ctrl", "Shift", "S"], description: "Strikethrough" },
      { keys: ["Ctrl", "E"],     description: "Inline code" },
    ],
  },
  {
    title: "Editor",
    tips: [
      { keys: ["Ctrl", "Z"],     description: "Undo" },
      { keys: ["Ctrl", "Shift", "Z"], description: "Redo" },
      { keys: ["Ctrl", "H"],     description: "Find & replace" },
      { action: "Type /",        description: "Slash menu" },
      { action: "Win+H / Fn twice", description: "Voice typing (system dictation)" }
    ],
  },
  {
    title: "Linking & Menus",
    tips: [
      { action: "Type [[",       description: "Wiki link" },
      { keys: ["Esc"],           description: "Dismiss menu" },
      { keys: ["Ctrl", ";"],     description: "Toggle backlinks" },
      { keys: ["Ctrl", "'"],     description: "Toggle outline" },
    ],
  },
  {
    title: "Graph",
    tips: [
      { keys: ["Ctrl", "Shift", "G"], description: "Open/close graph" },
      { action: "Shift + Click", description: "Focus node in graph" },
      { action: "Ctrl + Click",  description: "Open node in new tab" },
      { keys: ["Enter"],         description: "Cycle search matches" },
    ],
  },
  {
    title: "Daily & Org",
    tips: [
      { action: "Daily note",    description: "Open today's note" },
      { action: "Drag note",     description: "Reorder notes" },
      { action: "Right-click → Pin", description: "Pin to top" },
      { action: "Right-click → Move", description: "Re-parent note" },
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
  const tipsOpen = useUIStore((s) => s.tipsOpen);
  const closeTips = useUIStore((s) => s.closeTips);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!tipsOpen) return;
    function handle(e: KeyboardEvent) {
      if (e.key === "Escape") closeTips();
    }
    document.addEventListener("keydown", handle);
    return () => document.removeEventListener("keydown", handle);
  }, [tipsOpen, closeTips]);

  const handleTipClick = (tip: Tip) => {
    const action = getTipAction(tip.description, tip.keys);
    if (action) {
      action();
      closeTips();
    }
  };

  return (
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
        <div className="flex items-center justify-between px-5 pt-3 pb-2">
          <span className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">
            Tips & shortcuts
          </span>
          <button
            onClick={closeTips}
            className="w-6 h-6 flex items-center justify-center rounded text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors duration-100"
            aria-label="Close tips"
          >
            <svg width="10" height="10" viewBox="0 0 8 8" fill="none">
              <path d="M1 1l6 6M7 1L1 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="overflow-x-auto pb-3 px-5" style={{ scrollbarWidth: "none" }}>
          <div className="flex gap-8 min-w-max">
            {TIPS_BY_CATEGORY.map((category) => (
              <div key={category.title} className="w-52 shrink-0">
                <p className="text-[11px] font-semibold text-zinc-400 dark:text-zinc-500 uppercase tracking-wide mb-2">
                  {category.title}
                </p>
                <div className="space-y-1.5">
                  {category.tips.map((tip, i) => {
                    const hasAction = getTipAction(tip.description, tip.keys) !== undefined;
                    return (
                      <div
                        key={i}
                        onClick={() => handleTipClick(tip)}
                        className={`flex items-start gap-2 ${hasAction ? 'cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800/50 rounded transition-colors duration-100' : ''}`}
                        style={{ padding: hasAction ? '2px 4px' : '0' }}
                        title={hasAction ? 'Click to execute' : ''}
                      >
                        <div className="flex items-center gap-0.5 shrink-0 min-w-[6.5rem]">
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
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}