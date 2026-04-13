// src/features/ui/components/SidebarRail.tsx
import { useUIStore } from "@/features/ui/store/useUIStore";
import { useNoteStore } from "@/features/notes/store/useNoteStore";
import type { SidebarPanel } from "@/features/ui/store/useUIStore";

interface RailButtonProps {
  label: string;
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}

function RailButton({ label, active, onClick, children }: RailButtonProps) {
  return (
    <button
      onClick={onClick}
      title={label}
      className={`
        relative w-9 h-9 flex items-center justify-center rounded-md
        transition-colors duration-150
        ${active
          ? "bg-zinc-200 dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100"
          : "text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-200 dark:hover:bg-zinc-700"
        }
      `}
    >
      {children}
    </button>
  );
}

export function SidebarRail() {
  const activeSidebarPanel    = useUIStore((s) => s.activeSidebarPanel);
  const toggleSidebarPanel    = useUIStore((s) => s.toggleSidebarPanel);
  const openSettings          = useUIStore((s) => s.openSettings);
  const openTemplatePicker    = useUIStore((s) => s.openTemplatePicker);
  const graphOpen             = useUIStore((s) => s.graphOpen);
  const openGraph             = useUIStore((s) => s.openGraph);
  const closeGraph            = useUIStore((s) => s.closeGraph);
  const createOrOpenDailyNote = useNoteStore((s) => s.createOrOpenDailyNote);

  function toggle(panel: NonNullable<SidebarPanel>) {
    toggleSidebarPanel(panel);
  }

  return (
    <div className="flex flex-col items-center w-12 h-full shrink-0 py-2 gap-0.5 bg-zinc-50 dark:bg-zinc-900 border-r border-zinc-200 dark:border-zinc-800 z-10">

      <RailButton label="Notes (Ctrl+\)" active={activeSidebarPanel === "notes"} onClick={() => toggle("notes")}>
        <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
          <rect x="2" y="2" width="11" height="2.5" rx="1" fill="currentColor" opacity="0.9"/>
          <rect x="2" y="6.25" width="11" height="2.5" rx="1" fill="currentColor" opacity="0.9"/>
          <rect x="2" y="10.5" width="7" height="2" rx="1" fill="currentColor" opacity="0.9"/>
        </svg>
      </RailButton>

      <RailButton label="Search (Ctrl+F)" active={activeSidebarPanel === "search"} onClick={() => toggle("search")}>
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <circle cx="6" cy="6" r="4" stroke="currentColor" strokeWidth="1.4"/>
          <path d="M9.5 9.5L13 13" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
        </svg>
      </RailButton>

      <RailButton label="Tags" active={activeSidebarPanel === "tags"} onClick={() => toggle("tags")}>
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path d="M1.5 1.5h4.5l6 6-4.5 4.5-6-6V1.5z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/>
          <circle cx="4.5" cy="4.5" r="1" fill="currentColor"/>
        </svg>
      </RailButton>

      <RailButton label="Trash" active={activeSidebarPanel === "trash"} onClick={() => toggle("trash")}>
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path d="M2 3.5h10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
          <path d="M5 3.5V2.5h4v1" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
          <path d="M3.5 3.5l.5 8h6l.5-8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </RailButton>

      <RailButton
        label="Graph (Ctrl+Shift+G)"
        active={graphOpen}
        onClick={() => graphOpen ? closeGraph() : openGraph()}
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <circle cx="7" cy="7" r="1.5" fill="currentColor"/>
          <circle cx="2.5" cy="4" r="1.5" fill="currentColor"/>
          <circle cx="11.5" cy="4" r="1.5" fill="currentColor"/>
          <circle cx="2.5" cy="10" r="1.5" fill="currentColor"/>
          <circle cx="11.5" cy="10" r="1.5" fill="currentColor"/>
          <path d="M7 7L2.5 4M7 7l4.5-3M7 7l-4.5 3M7 7l4.5 3" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/>
        </svg>
      </RailButton>

      <div className="flex-1" />

      <RailButton label="Today's note" onClick={() => createOrOpenDailyNote().catch(console.error)}>
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <rect x="1.5" y="2.5" width="11" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.3"/>
          <path d="M4.5 1.5v2M9.5 1.5v2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
          <path d="M1.5 5.5h11" stroke="currentColor" strokeWidth="1.1"/>
          <text x="7" y="11.5" textAnchor="middle" fontSize="4.5" fontWeight="600" fill="currentColor">
            {new Date().getDate()}
          </text>
        </svg>
      </RailButton>

      <RailButton label="New note (Ctrl+N)" onClick={openTemplatePicker}>
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path d="M9.5 2L12.5 5M2 13l1-3.5L10 2l3 3-7 7.5L2 13z" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </RailButton>

      <div className="w-5 h-px bg-zinc-200 dark:bg-zinc-800 my-0.5" />

      <RailButton label="Settings (Ctrl+,)" onClick={openSettings}>
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <circle cx="7" cy="7" r="1.8" stroke="currentColor" strokeWidth="1.2"/>
          <path d="M7 1.5v1M7 11.5v1M1.5 7h1M11.5 7h1M3.1 3.1l.7.7M10.2 10.2l.7.7M10.9 3.1l-.7.7M3.8 10.2l-.7.7"
            stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
        </svg>
      </RailButton>

    </div>
  );
}