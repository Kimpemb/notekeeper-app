// src/features/notes/components/Sidebar/NotesPanel.tsx
import { useState } from "react";
import { useUIStore } from "@/features/ui/store/useUIStore";
import { NoteTree } from "./NoteTree";

type SortOrder = 
  | "alpha-asc" 
  | "alpha-desc" 
  | "modified-desc" 
  | "modified-asc" 
  | "created-desc" 
  | "created-asc";

const SORT_LABELS: Record<SortOrder, string> = {
  "alpha-asc":     "File name (A to Z)",
  "alpha-desc":    "File name (Z to A)",
  "modified-desc": "Modified time (new to old)",
  "modified-asc":  "Modified time (old to new)",
  "created-desc":  "Created time (new to old)",
  "created-asc":   "Created time (old to new)",
};

export function NotesPanel() {
  const openTemplatePicker = useUIStore((s) => s.openTemplatePicker);
  const collapseAllNodes   = useUIStore((s) => s.collapseAllNodes);
  const expandAllNodes     = useUIStore((s) => s.expandAllNodes);
  const expandedNodes      = useUIStore((s) => s.expandedNodes);

  const [sortOrder, setSortOrder] = useState<SortOrder>("modified-desc");
  const [sortMenuOpen, setSortMenuOpen] = useState(false);

  const allExpanded = expandedNodes.size > 0;

  function toggleExpandCollapse() {
    allExpanded ? collapseAllNodes() : expandAllNodes();
  }

  const btnClass =
    "w-8 h-8 flex items-center justify-center rounded-md text-idemora-text-muted " +
    "hover:bg-black/6 dark:hover:bg-white/7 transition-colors duration-150";

  return (
    <div className="flex flex-col h-full min-h-0">

      {/* Header — 3 centered icons */}
      <div className="flex items-center justify-center gap-2 px-2 pt-0 pb-0 shrink-0 relative">

        {/* 1. New note */}
        <button onClick={openTemplatePicker} title="New note" className={btnClass}>
          <svg width="20" height="20" viewBox="0 0 22 22" fill="none">
            <path
              d="M10 4H5a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5"
              stroke="currentColor" strokeWidth="1.7"
              strokeLinecap="round" strokeLinejoin="round"
            />
            <path
              d="M17.5 2.5a2 2 0 012.8 2.8L13 13l-4 1 1-4 7.5-7.5z"
              stroke="currentColor" strokeWidth="1.7"
              strokeLinecap="round" strokeLinejoin="round"
            />
          </svg>
        </button>

        {/* 2. Sort order with dropdown */}
        <div className="relative">
          <button
            onClick={() => setSortMenuOpen(!sortMenuOpen)}
            title="Sort notes"
            className={btnClass}
          >
            <svg width="20" height="20" viewBox="0 0 22 22" fill="none">
              <path
                d="M3 6h16M6 11h10M9 16h4"
                stroke="currentColor" strokeWidth="1.7"
                strokeLinecap="round"
              />
            </svg>
          </button>

          {sortMenuOpen && (
            <>
              <div
                className="fixed inset-0 z-40"
                onClick={() => setSortMenuOpen(false)}
              />
              <div className="absolute top-full left-1/2 -translate-x-1/2 mt-1 z-50 min-w-[180px] py-1 rounded-lg shadow-xl bg-idemora-bg-secondary border border-idemora-border">
                {(Object.entries(SORT_LABELS) as [SortOrder, string][]).map(([value, label]) => (
                  <button
                    key={value}
                    onClick={() => {
                      setSortOrder(value);
                      setSortMenuOpen(false);
                    }}
                    className={`w-full text-left px-3 py-1.5 text-xs transition-colors duration-100 ${
                      sortOrder === value
                        ? "bg-blue-500/10 text-blue-400"
                        : "text-idemora-text-muted hover:bg-black/[0.06] dark:hover:bg-white/[0.07]"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        {/* 3. Expand / collapse */}
        <button
          onClick={toggleExpandCollapse}
          title={allExpanded ? "Collapse all" : "Expand all"}
          className={btnClass}
        >
          {allExpanded ? (
            <svg width="20" height="20" viewBox="0 0 22 22" fill="none">
              <path
                d="M6 8l5 5 5-5"
                stroke="currentColor" strokeWidth="1.7"
                strokeLinecap="round" strokeLinejoin="round"
              />
              <path
                d="M6 14l5-5 5 5"
                stroke="currentColor" strokeWidth="1.7"
                strokeLinecap="round" strokeLinejoin="round"
              />
            </svg>
          ) : (
            <svg width="20" height="20" viewBox="0 0 22 22" fill="none">
              <path
                d="M6 9l5-5 5 5"
                stroke="currentColor" strokeWidth="1.7"
                strokeLinecap="round" strokeLinejoin="round"
              />
              <path
                d="M6 13l5 5 5-5"
                stroke="currentColor" strokeWidth="1.7"
                strokeLinecap="round" strokeLinejoin="round"
              />
            </svg>
          )}
        </button>

      </div>

      {/* Note tree */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden py-2 min-h-0">
        <NoteTree sortOrder={sortOrder} />
      </div>

    </div>
  );
}