// src/features/notes/components/Sidebar/index.tsx
import { useEffect, useRef, useState } from "react";
import { useUIStore } from "@/features/ui/store/useUIStore";
import { SidebarRail } from "@/features/ui/components/SidebarRail";
import { NotesPanel } from "./NotesPanel";
import { SearchPanel } from "./SearchPanel";
import { TagsPanel } from "./TagsPanel";
import { TrashPanel } from "./TrashPanel";
import { BookmarksPanel } from "./BookmarksPanel";



export function Sidebar() {
  const activeSidebarPanel    = useUIStore((s) => s.activeSidebarPanel);
  const setActiveSidebarPanel = useUIStore((s) => s.setActiveSidebarPanel);
  const focusSidebarSearch    = useUIStore((s) => s.focusSidebarSearch);
  const sidebarWidth          = useUIStore((s) => s.sidebarWidth);

  const lastPanelRef = useRef<typeof activeSidebarPanel>(activeSidebarPanel ?? null);
  if (activeSidebarPanel !== null) lastPanelRef.current = activeSidebarPanel;
  const renderedPanel = activeSidebarPanel ?? lastPanelRef.current;

  const [transitioning, setTransitioning] = useState(false);
  const transitionTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const prevPanel = useRef(activeSidebarPanel);

  useEffect(() => {
    if (prevPanel.current === activeSidebarPanel) return;
    prevPanel.current = activeSidebarPanel;
    setTransitioning(true);
    clearTimeout(transitionTimer.current);
    transitionTimer.current = setTimeout(() => setTransitioning(false), 160);
    return () => clearTimeout(transitionTimer.current);
  }, [activeSidebarPanel]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const mod = navigator.platform.toUpperCase().includes("MAC") ? e.metaKey : e.ctrlKey;
      if (mod && e.key === "f") {
        e.preventDefault();
        e.stopPropagation();
        setActiveSidebarPanel("search");
        requestAnimationFrame(() => focusSidebarSearch?.());
      }
    }
    window.addEventListener("keydown", handleKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", handleKeyDown, { capture: true });
  }, [setActiveSidebarPanel, focusSidebarSearch]);

  const panelOpen = activeSidebarPanel !== null;

  return (
    <div className="flex h-full shrink-0">
      <SidebarRail />
      <div
        style={{
          width: panelOpen ? `${sidebarWidth}px` : "0px",
          willChange: transitioning ? "width" : "auto",
        }}
        className="relative flex flex-col h-full overflow-hidden bg-idemora-bg-secondary border-r border-idemora-border transition-[width] duration-150 ease-in-out shrink-0"
      >
        {/* Panel content — all always mounted, only active one is visible */}
        {(["notes", "search", "tags", "trash", "bookmarks"] as const).map((panel) => (
          <div
            key={panel}
            style={{
              visibility: renderedPanel === panel ? "visible" : "hidden",
              pointerEvents: activeSidebarPanel === panel ? "auto" : "none",
              position: "absolute",
              width: `${sidebarWidth}px`,
              top: "0px",
              bottom: 0,
            }}
          >
            {panel === "notes"     && <NotesPanel />}
            {panel === "search"    && <SearchPanel />}
            {panel === "tags"      && <TagsPanel />}
            {panel === "trash"     && <TrashPanel />}
            {panel === "bookmarks" && <BookmarksPanel />}
          </div>
        ))}
      </div>
    </div>
  );
}