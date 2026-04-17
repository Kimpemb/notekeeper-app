// src/features/ui/components/SidebarRail.tsx
import { useCallback } from "react";
import { useUIStore } from "@/features/ui/store/useUIStore";
import { useNoteStore } from "@/features/notes/store/useNoteStore";
import { useCanvasStore } from "@/features/canvas/store/useCanvasStore";

function RailButton({
  label,
  active,
  accent,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  accent?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      className={[
        "relative w-8 h-8 flex items-center justify-center rounded-lg",
        "transition-colors duration-150 cursor-pointer",
        active
          ? accent
            ? "text-blue-400 bg-blue-500/10"
            : "text-idemora-text-normal bg-idemora-bg-secondary"
          : "text-idemora-text-muted hover:bg-black/[0.06] dark:hover:bg-white/[0.07]",
      ].join(" ")}
    >
      {active && (
        <span className="absolute left-0 top-2 bottom-2 w-0.5 rounded-r-full bg-blue-500" />
      )}
      {children}
    </button>
  );
}

export function SidebarRail() {
  const openSettings          = useUIStore((s) => s.openSettings);
  const openTemplatePicker    = useUIStore((s) => s.openTemplatePicker);
  const graphOpen             = useUIStore((s) => s.graphOpen);
  const openGraph             = useUIStore((s) => s.openGraph);
  const closeGraph            = useUIStore((s) => s.closeGraph);
  const createOrOpenDailyNote = useNoteStore((s) => s.createOrOpenDailyNote);

  const createNewCanvas = useCallback(async () => {
  const canvas = await useCanvasStore.getState().createCanvas("Untitled Canvas");
  useUIStore.getState().openCanvas(canvas.id, canvas.name);
}, []);

  return (
    <div className="flex flex-col items-center w-12 h-full shrink-0 py-1.5 gap-1 bg-idemora-bg-secondary border-r border-idemora-border z-10">
      <RailButton label="Graph (Ctrl+Shift+G)" active={graphOpen} accent onClick={() => graphOpen ? closeGraph() : openGraph()}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="2.5"/>
          <circle cx="5" cy="6" r="2"/>
          <circle cx="19" cy="6" r="2"/>
          <circle cx="5" cy="18" r="2"/>
          <circle cx="19" cy="18" r="2"/>
          <path d="M12 12L5 6M12 12l7-6M12 12l-7 6M12 12l7 6"/>
        </svg>
      </RailButton>

      <RailButton label="Today's note" onClick={() => createOrOpenDailyNote().catch(console.error)}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
          <line x1="8" y1="2" x2="8" y2="6"/>
          <line x1="16" y1="2" x2="16" y2="6"/>
          <line x1="3" y1="10" x2="21" y2="10"/>
          <text x="12" y="18" textAnchor="middle" fontSize="8" fontWeight="bold" fill="currentColor">
            {new Date().getDate()}
          </text>
        </svg>
      </RailButton>

      <RailButton label="New canvas" onClick={createNewCanvas}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <rect x="2" y="3" width="9" height="9" rx="1.5"/>
          <rect x="13" y="3" width="9" height="5" rx="1.5"/>
          <rect x="13" y="12" width="9" height="9" rx="1.5"/>
          <rect x="2" y="16" width="9" height="5" rx="1.5"/>
        </svg>
      </RailButton>

      <RailButton label="Templates" onClick={openTemplatePicker}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <rect x="4" y="4" width="16" height="16" rx="2"/>
          <line x1="9" y1="8" x2="15" y2="8"/>
          <line x1="9" y1="12" x2="13" y2="12"/>
          <line x1="9" y1="16" x2="11" y2="16"/>
        </svg>
      </RailButton>

      <RailButton label="Settings (Ctrl+,)" onClick={openSettings}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="3"/>
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
        </svg>
      </RailButton>
    </div>
  );
}