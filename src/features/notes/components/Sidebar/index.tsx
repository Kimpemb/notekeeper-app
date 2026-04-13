// src/features/notes/components/Sidebar/index.tsx
import { useEffect } from "react";
import { useUIStore } from "@/features/ui/store/useUIStore";
import { SidebarRail } from "@/features/ui/components/SidebarRail";
import { NotesPanel } from "./NotesPanel";
import { SearchPanel } from "./SearchPanel";
import { TagsPanel } from "./TagsPanel";
import { TrashPanel } from "./TrashPanel";

export function Sidebar() {
  const activeSidebarPanel = useUIStore((s) => s.activeSidebarPanel);
  const setActiveSidebarPanel = useUIStore((s) => s.setActiveSidebarPanel);
  const focusSidebarSearch = useUIStore((s) => s.focusSidebarSearch);
  const sidebarWidth = useUIStore((s) => s.sidebarWidth);

  // ── Ctrl+F → open search panel and focus the search input ────────────────
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const isMac = navigator.platform.toUpperCase().includes("MAC");
      const mod = isMac ? e.metaKey : e.ctrlKey;
      if (mod && e.key === "f") {
        e.preventDefault();
        e.stopPropagation();
        setActiveSidebarPanel("search");
        // Give the panel a frame to mount before focusing
        requestAnimationFrame(() => focusSidebarSearch?.());
      }
    }
    window.addEventListener("keydown", handleKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", handleKeyDown, { capture: true });
  }, [setActiveSidebarPanel, focusSidebarSearch]);

  const panelOpen = activeSidebarPanel !== null;

  return (
    <div className="flex h-full shrink-0">
      {/* Always-visible rail */}
      <SidebarRail />

      {/* Sliding panel — width-transitions open/closed */}
      <div
        style={{
          width: panelOpen ? `${sidebarWidth}px` : "0px",
          opacity: panelOpen ? 1 : 0,
        }}
        className="flex flex-col h-full overflow-hidden bg-zinc-50 dark:bg-zinc-900 border-r border-zinc-200 dark:border-zinc-800 transition-[width,opacity] duration-200 ease-[cubic-bezier(0.4,0,0.2,1)] shrink-0"
      >
        {/* Render all panels; only the active one is visible via display */}
        <div style={{ display: activeSidebarPanel === "notes"  ? "flex" : "none" }} className="flex-col h-full min-h-0 w-full">
          <NotesPanel />
        </div>
        <div style={{ display: activeSidebarPanel === "search" ? "flex" : "none" }} className="flex-col h-full min-h-0 w-full">
          <SearchPanel />
        </div>
        <div style={{ display: activeSidebarPanel === "tags"   ? "flex" : "none" }} className="flex-col h-full min-h-0 w-full">
          <TagsPanel />
        </div>
        <div style={{ display: activeSidebarPanel === "trash"  ? "flex" : "none" }} className="flex-col h-full min-h-0 w-full">
          <TrashPanel />
        </div>
      </div>
    </div>
  );
}