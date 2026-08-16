// src/features/notes/components/Sidebar/ChatHistoryPanel.tsx
import { useEffect, useState } from "react";
import { getRecentChatSessions, type RecentChatSession } from "@/features/notes/db/queries";
import { useUIStore } from "@/features/ui/store/useUIStore";

// ─── Breadcrumb truncation ──────────────────────────────────────────────────
// computeBreadcrumb() returns " / "-joined titles, last segment is the note's
// own title. "3 degrees toward the note" = the 3 folder segments just above
// it, excluding the note's own title.
function truncateBreadcrumb(breadcrumb: string): string {
  const parts = breadcrumb.split(" / ");
  if (parts.length <= 4) return breadcrumb;
  return ".../" + parts.slice(-4, -1).join("/");
}

function ClockIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" className="text-idemora-text-faint">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.4" />
      <polyline points="12 7 12 12 15.5 14" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function ChatHistoryPanel() {
  const [sessions, setSessions] = useState<RecentChatSession[]>([]);
  const [loading, setLoading]   = useState(true);
  const replaceTab   = useUIStore((s) => s.replaceTab);
  const openChat     = useUIStore((s) => s.openChat);
  const isActivePanel = useUIStore((s) => s.activeSidebarPanel === "chatHistory");

  useEffect(() => {
    // Refetch every time the panel becomes the active one — covers new
    // sessions, updated ordering, and titles that finished generating while
    // this panel wasn't visible.
    if (!isActivePanel) return;
    let cancelled = false;
    setLoading(true);
    getRecentChatSessions(20)
      .then((rows) => { if (!cancelled) setSessions(rows); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [isActivePanel]);

  useEffect(() => {
    // While the panel is open and visible, poll lightly so a title that
    // finishes generating mid-session (or a new session getting saved)
    // shows up without needing to close/reopen the panel.
    if (!isActivePanel) return;
    const interval = setInterval(() => {
      getRecentChatSessions(20).then(setSessions).catch(() => {});
    }, 5000);
    return () => clearInterval(interval);
  }, [isActivePanel]);

  function openSession(noteId: string) {
    replaceTab(noteId);
    openChat(1);
  }

  // ── empty / loading state ─────────────────────────────────────────────────
  if (!loading && sessions.length === 0) {
    return (
      <div className="flex flex-col h-full min-h-0 bg-idemora-bg-secondary">
        <div className="flex-1 flex flex-col items-center justify-center gap-2 px-4 py-10 text-center">
          <ClockIcon />
          <p className="text-xs text-idemora-text-muted">No recent chats</p>
          <p className="text-xs text-idemora-text-faint">Chat sessions you start on a note will show up here</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0 bg-idemora-bg-secondary">
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-2 px-4 py-10 text-center">
            <ClockIcon />
            <p className="text-xs text-idemora-text-muted">Loading…</p>
          </div>
        ) : (
          sessions.map((s) => (
            <button
              key={s.noteId}
              onClick={() => openSession(s.noteId)}
              className="flex flex-col items-start w-full text-left px-3 py-2 hover:bg-black/[0.06] dark:hover:bg-white/[0.07] transition-colors duration-150"
            >
              <span className="text-sm text-idemora-text-normal leading-snug truncate w-full">
                {s.title}
              </span>
              <span className="text-xs text-idemora-text-muted leading-snug truncate w-full">
                {truncateBreadcrumb(s.breadcrumb)}
              </span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}