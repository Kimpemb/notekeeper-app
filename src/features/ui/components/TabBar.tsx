import { useState, useRef, useEffect, useCallback } from "react";
import { useUIStore } from "@/features/ui/store/useUIStore";
import { useNoteStore } from "@/features/notes/store/useNoteStore";

interface ContextMenu { x: number; y: number; tabId: string; noteId: string; flip: boolean; }

export function TabBar() {
  const notes = useNoteStore((s) => s.notes);
  const activePaneId = useUIStore((s) => s.activePaneId);
  const setActiveNote = useNoteStore((s) => s.setActiveNote);
  
  // Dynamic selectors based on active pane
  const tabs = useUIStore((s) => activePaneId === 1 ? s.tabs : s.pane2Tabs);
  const activeTabId = useUIStore((s) => activePaneId === 1 ? s.activeTabId : s.pane2ActiveTabId);
  const setActive = useUIStore((s) => activePaneId === 1 ? s.setActiveTab : s.setPane2ActiveTab);
  const closeTab = useUIStore((s) => activePaneId === 1 ? s.closeTab : s.closePane2Tab);
  
  const openEmptyTab = useUIStore((s) => activePaneId === 1 ? s.openEmptyTab : s.openEmptyTabInPane2);
  const openInSplit = useUIStore((s) => s.openInSplit);
  const openTabInPane2 = useUIStore((s) => s.openTabInPane2);
  const setActivePaneId = useUIStore((s) => s.setActivePaneId);
  const reorderTabs = useUIStore((s) => s.reorderTabs);

const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null);
const [emptySpaceMenu, setEmptySpaceMenu] = useState<{ x: number; y: number; flip: boolean } | null>(null);
const menuRef = useRef<HTMLDivElement>(null);
const emptyMenuRef = useRef<HTMLDivElement>(null);
const closedTabs = useUIStore((s) => s.closedTabs);
const reopenClosedTab = useUIStore((s) => s.reopenClosedTab);
  const scrollRef = useRef<HTMLDivElement>(null);

// Scroll to end only when a tab is added to the same pane.
// Closing a tab or switching panes must not move the bar.
const prevTabCount = useRef(tabs.length);
const prevPaneId = useRef(activePaneId);
useEffect(() => {
  const grew = tabs.length > prevTabCount.current && prevPaneId.current === activePaneId;
  prevTabCount.current = tabs.length;
  prevPaneId.current = activePaneId;
  if (grew && scrollRef.current) {
    scrollRef.current.scrollTo({
      left: scrollRef.current.scrollWidth,
      behavior: "smooth",
    });
  }
}, [tabs.length, activePaneId]);

// Scroll active tab into view when switching via keyboard
useEffect(() => {
  if (!scrollRef.current) return;
  const activeEl = scrollRef.current.querySelector(`[data-tab-id="${activeTabId}"]`) as HTMLElement | null;
  if (activeEl) {
    activeEl.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
  }
}, [activeTabId]);

useEffect(() => {
  if (!contextMenu) return;
  const handle = (e: MouseEvent) => {
    if (menuRef.current && !menuRef.current.contains(e.target as Node)) setContextMenu(null);
  };
  document.addEventListener("mousedown", handle);
  return () => document.removeEventListener("mousedown", handle);
}, [contextMenu]);

useEffect(() => {
  if (!emptySpaceMenu) return;
  const handle = (e: MouseEvent) => {
    if (emptyMenuRef.current && !emptyMenuRef.current.contains(e.target as Node)) setEmptySpaceMenu(null);
  };
  document.addEventListener("mousedown", handle);
  return () => document.removeEventListener("mousedown", handle);
}, [emptySpaceMenu]);

// ─── Drag to reorder ─────────────────────────────────────────────────────────
// Stability: every tab has the same fixed width, so slot positions are plain
// arithmetic (index * stride). The target slot is computed from the pointer
// offset alone and never from hit-testing moved elements, which is what makes
// tabs jitter. Other tabs are shifted by exactly one stride with a transform.
const DRAG_THRESHOLD = 5;
const EDGE_ZONE = 36;
const EDGE_SPEED = 14;
const SETTLE_MS = 130;
// Hysteresis: a neighbour swaps only once the dragged tab is this far (in tab widths) past
// the midpoint, and swaps back only after crossing the same margin the other way.
const SWAP_MARGIN = 0.1;

interface DragState { id: string; from: number; to: number; offset: number; settling: boolean; }
interface DragRefs {
  id: string; from: number; to: number; stride: number; count: number;
  startX: number; startScroll: number; lastX: number;
  active: boolean; dirty: boolean; pointerId: number; el: HTMLElement; raf: number; timer: number;
}

const [drag, setDrag] = useState<DragState | null>(null);
const dragRef = useRef<DragRefs | null>(null);
const suppressClick = useRef(false);
const lastDrag = useRef<DragState | null>(null);

const computeDrag = useCallback(() => {
  const d = dragRef.current;
  const sc = scrollRef.current;
  if (!d || !d.active || !sc) return;
  let offset = (d.lastX - d.startX) + (sc.scrollLeft - d.startScroll);
  // Keep the dragged tab inside the strip of tabs
  offset = Math.max(-d.from * d.stride, Math.min((d.count - 1 - d.from) * d.stride, offset));
  // Dragged tab's position in slot units; move the target one slot at a time with a dead zone
  const pos = d.from + offset / d.stride;
  let to = d.to;
  while (to < d.count - 1 && pos > to + 0.5 + SWAP_MARGIN) to++;
  while (to > 0 && pos < to - 0.5 - SWAP_MARGIN) to--;
  d.dirty = false;
  if (to === d.to && lastDrag.current && lastDrag.current.offset === offset) return;
  d.to = to;
  const next = { id: d.id, from: d.from, to, offset, settling: false };
  lastDrag.current = next;
  setDrag(next);
}, []);

const stopAutoScroll = () => {
  const d = dragRef.current;
  if (d && d.raf) { cancelAnimationFrame(d.raf); d.raf = 0; }
};

const autoScrollTick = useCallback(() => {
  const d = dragRef.current;
  const sc = scrollRef.current;
  if (!d || !d.active || !sc) return;
  const rect = sc.getBoundingClientRect();
  let speed = 0;
  if (d.lastX < rect.left + EDGE_ZONE) speed = -EDGE_SPEED * Math.min(1, (rect.left + EDGE_ZONE - d.lastX) / EDGE_ZONE);
  else if (d.lastX > rect.right - EDGE_ZONE) speed = EDGE_SPEED * Math.min(1, (d.lastX - (rect.right - EDGE_ZONE)) / EDGE_ZONE);
  if (speed !== 0) {
    const before = sc.scrollLeft;
    sc.scrollLeft = before + speed;
    if (sc.scrollLeft !== before) d.dirty = true;
  }
  // Pointer moves only mark the drag dirty; React updates at most once per frame
  if (d.dirty) computeDrag();
  d.raf = requestAnimationFrame(autoScrollTick);
}, [computeDrag]);

const cancelDrag = useCallback(() => {
  const d = dragRef.current;
  if (d) {
    if (d.raf) cancelAnimationFrame(d.raf);
    if (d.timer) clearTimeout(d.timer);
    try { d.el.releasePointerCapture(d.pointerId); } catch { /* already released */ }
  }
  dragRef.current = null;
  lastDrag.current = null;
  setDrag(null);
}, []);

function handleTabPointerDown(e: React.PointerEvent<HTMLDivElement>, tabId: string, index: number) {
  suppressClick.current = false; // a new press starts a fresh click/drag decision
  if (e.button !== 0 || tabs.length < 2 || dragRef.current) return;
  if ((e.target as HTMLElement).closest("button")) return; // close button
  const el = e.currentTarget;
  const sc = scrollRef.current;
  if (!sc) return;
  const tabEls = sc.querySelectorAll<HTMLElement>("[data-tab]");
  const stride = tabEls.length > 1
    ? tabEls[1].offsetLeft - tabEls[0].offsetLeft
    : el.offsetWidth + 4;
  if (!(stride > 0)) return;
  dragRef.current = {
    id: tabId, from: index, to: index, stride, count: tabs.length,
    startX: e.clientX, startScroll: sc.scrollLeft, lastX: e.clientX,
    active: false, dirty: false, pointerId: e.pointerId, el, raf: 0, timer: 0,
  };
}

function handleTabPointerMove(e: React.PointerEvent<HTMLDivElement>) {
  const d = dragRef.current;
  if (!d || e.pointerId !== d.pointerId) return;
  d.lastX = e.clientX;
  if (!d.active) {
    if (Math.abs(e.clientX - d.startX) < DRAG_THRESHOLD) return;
    d.active = true;
    suppressClick.current = true;
    try { d.el.setPointerCapture(d.pointerId); } catch { /* ignore */ }
    d.raf = requestAnimationFrame(autoScrollTick);
  }
  d.dirty = true;
}

function finishDrag(e: React.PointerEvent<HTMLDivElement>) {
  const d = dragRef.current;
  if (!d || e.pointerId !== d.pointerId) return;
  if (!d.active) { dragRef.current = null; return; } // plain click, let onClick run
  stopAutoScroll();
  try { d.el.releasePointerCapture(d.pointerId); } catch { /* ignore */ }
  d.lastX = e.clientX;
  computeDrag(); // settle on the exact release position, not the last rendered frame
  // Settle: glide the dragged tab into its slot, then commit the new order and clear
  // every transform in the same render so nothing visibly jumps.
  const { id, from, to, stride } = d;
  setDrag({ id, from, to, offset: (to - from) * stride, settling: true });
  d.active = false;
  d.timer = window.setTimeout(() => {
    dragRef.current = null;
    lastDrag.current = null;
    if (to !== from) reorderTabs(activePaneId, from, to);
    setDrag(null);
  }, SETTLE_MS);
}

// Escape cancels an in-progress drag; a tab list that changes underneath also cancels
useEffect(() => {
  if (!drag) return;
  const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !drag.settling) { e.preventDefault(); cancelDrag(); } };
  window.addEventListener("keydown", onKey, true);
  return () => window.removeEventListener("keydown", onKey, true);
}, [drag, cancelDrag]);

useEffect(() => {
  if (dragRef.current) cancelDrag();
}, [activePaneId, tabs.length]); // eslint-disable-line react-hooks/exhaustive-deps

useEffect(() => () => {
  const d = dragRef.current;
  if (d) { if (d.raf) cancelAnimationFrame(d.raf); if (d.timer) clearTimeout(d.timer); }
}, []);

function dragStyle(index: number, tabId: string): React.CSSProperties | undefined {
  if (!drag) return undefined;
  if (tabId === drag.id) {
    return {
      transform: `translate3d(${drag.offset}px, 0, 0)`,
      transition: drag.settling ? `transform ${SETTLE_MS}ms cubic-bezier(0.2, 0, 0, 1)` : "none",
      zIndex: 30,
      boxShadow: drag.settling ? undefined : "0 4px 14px rgba(0,0,0,0.25)",
      cursor: "grabbing",
      willChange: "transform",
    };
  }
  let shift = 0;
  if (drag.from < drag.to && index > drag.from && index <= drag.to) shift = -1;
  else if (drag.from > drag.to && index >= drag.to && index < drag.from) shift = 1;
  const stride = dragRef.current?.stride ?? 0;
  return {
    transform: shift === 0 ? "translate3d(0, 0, 0)" : `translate3d(${shift * stride}px, 0, 0)`,
    transition: "transform 150ms cubic-bezier(0.2, 0, 0, 1)",
    willChange: "transform",
  };
}

  return (
    <div className="relative flex items-center flex-1 min-w-0 h-full ml-8">
      <div
  ref={scrollRef}
  className="flex items-center h-full overflow-x-auto overflow-y-hidden min-w-0 flex-1 gap-1 px-2"
  style={{ scrollbarWidth: "none" }}
  onContextMenu={(e) => {
    if ((e.target as HTMLElement).closest("[data-tab]")) return;
    e.preventDefault();
    setEmptySpaceMenu({ x: e.clientX, y: e.clientY, flip: window.innerHeight - e.clientY < 260 });
  }}
>
        {tabs.map((tab, tabIndex) => {
          const note = tab.noteId ? notes.find((n) => n.id === tab.noteId) : null;
          let title = "";
          if (tab.noteId === null) {
            title = "New tab";
          } else {
            title = note ? note.title : "…";
          }
          const isActive = tab.id === activeTabId;

          return (
            <div
  key={tab.id}
  data-tab="true"
  data-tab-id={tab.id}
  style={dragStyle(tabIndex, tab.id)}
              onPointerDown={(e) => handleTabPointerDown(e, tab.id, tabIndex)}
              onPointerMove={handleTabPointerMove}
              onPointerUp={finishDrag}
              onPointerCancel={cancelDrag}
              onClick={() => {
                if (suppressClick.current) return; // this click is the end of a drag
                setActive(tab.id);
                if (tab.noteId) setActiveNote(tab.noteId, true);
              }}
              onAuxClick={(e) => { if (e.button === 1) closeTab(tab.id); }}
              onContextMenu={(e) => {
                if (!tab.noteId) return;
                e.preventDefault();
                setContextMenu({ x: e.clientX, y: e.clientY, tabId: tab.id, noteId: tab.noteId, flip: window.innerHeight - e.clientY < 120 });
              }}
              className={`
                group relative flex items-center gap-2 shrink-0 cursor-pointer select-none px-3 h-8 w-40 text-sm font-medium transition-colors
                ${isActive 
                  ? "bg-idemora-bg-primary text-idemora-text-normal rounded-t-md z-20" 
                  : "bg-transparent text-idemora-text-muted hover:bg-black/4 dark:hover:bg-white/4 rounded-md"
                }
              `}
            >
              {/* Vertical Alignment Guard: Icon and Text */}
              <span className={`shrink-0 opacity-60 ${
                note?.source_type === "pdf"  ? "text-red-400"    :
                note?.source_type === "docx" ? "text-blue-400"   :
                note?.source_type === "pptx" ? "text-orange-400" :
                note?.source_type === "notepad" ? "text-amber-400" :
                "opacity-50"
              }`}>
                {note?.is_canvas ? (
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                    <rect x="1" y="1" width="10" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.2"/>
                    <circle cx="4" cy="4" r="1" fill="currentColor"/>
                    <circle cx="8" cy="4" r="1" fill="currentColor"/>
                    <path d="M3 8l2-2 2 1.5 2-2.5" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                ) : note?.source_type === "notepad" ? (
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                    <rect x="2" y="2" width="8" height="9" rx="1" stroke="currentColor" strokeWidth="1.1"/>
                    <path d="M4 1v2M6 1v2M8 1v2" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/>
                    <path d="M4 5.5h4M4 7.3h4M4 9h2.5" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/>
                  </svg>
                ) : note?.source_type === "pdf" ? (
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                    <path d="M2 1.5h5.5L10 4v6.5a.5.5 0 01-.5.5h-7a.5.5 0 01-.5-.5v-9a.5.5 0 01.5-.5z" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round"/>
                    <path d="M7.5 1.5V4H10" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round"/>
                    <path d="M3.5 6.5h5M3.5 8.5h3" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/>
                  </svg>
                ) : note?.source_type === "docx" ? (
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                    <path d="M2 1.5h5.5L10 4v6.5a.5.5 0 01-.5.5h-7a.5.5 0 01-.5-.5v-9a.5.5 0 01.5-.5z" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round"/>
                    <path d="M7.5 1.5V4H10" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round"/>
                    <path d="M3.5 5.5h5M3.5 7h5M3.5 8.5h3" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/>
                  </svg>
                ) : note?.source_type === "pptx" ? (
                  <svg width="14" height="14" viewBox="0 0 12 12" fill="none">
                    <rect x="1" y="2.5" width="10" height="7" rx="1" stroke="currentColor" strokeWidth="1.1"/>
                    <path d="M4.5 5.5h3M4.5 7.5h2" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/>
                    <circle cx="3.5" cy="5.5" r="0.7" fill="currentColor"/>
                    <circle cx="3.5" cy="7.5" r="0.7" fill="currentColor"/>
                  </svg>
                ) : (
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                    <rect x="1" y="1" width="10" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.2"/>
                    <path d="M3.5 4h5M3.5 6h5M3.5 8h3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
                  </svg>
                )}
              </span>
              
              <span className="flex-1 truncate">{title}</span>

              <button
                onClick={(e) => { e.stopPropagation(); closeTab(tab.id); }}
                className={`p-0.5 rounded-sm hover:bg-black/10 dark:hover:bg-white/10 transition-opacity ${isActive ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}
              >
                <svg width="8" height="8" viewBox="0 0 7 7" fill="none">
                  <path d="M1 1l5 5M6 1L1 6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
                </svg>
              </button>

              {/* IMMERSION BRIDGE */}
              {/* This absolute div sits at the bottom and covers the gap/border of the header */}
              {isActive && (
                <div className="absolute -bottom-1.5 left-0 right-0 h-1.5 bg-idemora-bg-primary z-20" />
              )}
            </div>
          );
        })}

        <button
          onClick={() => openEmptyTab()}
          className="shrink-0 p-1.5 text-idemora-text-muted hover:text-idemora-text-normal hover:bg-black/4 dark:hover:bg-white/4 rounded-md transition-colors"
        >
          <svg width="12" height="12" viewBox="0 0 10 10" fill="none">
            <path d="M5 1v8M1 5h8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
          </svg>
        </button>
      </div>

      {contextMenu && (
        <div
          ref={menuRef}
          style={{ 
            position: "fixed", 
            left: contextMenu.x, 
            ...(contextMenu.flip ? { bottom: window.innerHeight - contextMenu.y } : { top: contextMenu.y }), 
            zIndex: 100 
          }}
          className="min-w-44 py-1 rounded-lg shadow-xl bg-idemora-bg-secondary border border-idemora-border"
        >
          <button
  onClick={() => { activePaneId === 1 ? useUIStore.getState().openTab(contextMenu.noteId) : openTabInPane2(contextMenu.noteId); setContextMenu(null); }}
  className="w-full text-left px-3 py-2 text-xs hover:bg-black/4 dark:hover:bg-white/4"
>
  Open in new tab
</button>
<button
  onClick={() => { activePaneId === 1 ? openInSplit(contextMenu.noteId) : (useUIStore.getState().openTab(contextMenu.noteId), setActivePaneId(1)); setContextMenu(null); }}
  className="w-full text-left px-3 py-2 text-xs hover:bg-black/4 dark:hover:bg-white/4"
>
  {activePaneId === 1 ? "Open in split pane" : "Open in main pane"}
</button>
<div className="my-1 border-t border-idemora-border" />
<button
  onClick={() => { reopenClosedTab(); setContextMenu(null); }}
  disabled={closedTabs.length === 0}
  className="w-full text-left px-3 py-2 text-xs hover:bg-black/4 dark:hover:bg-white/4 disabled:opacity-30 disabled:cursor-default"
>
  Reopen closed tab
</button>
        </div>
      )}

      {emptySpaceMenu && (
  <div
    ref={emptyMenuRef}
    style={{
      position: "fixed",
      left: emptySpaceMenu.x,
      ...(emptySpaceMenu.flip ? { bottom: window.innerHeight - emptySpaceMenu.y } : { top: emptySpaceMenu.y }),
      zIndex: 100,
    }}
    className="min-w-52 py-1 rounded-lg shadow-xl bg-idemora-bg-secondary border border-idemora-border"
  >
    <button
      disabled
      className="w-full text-left px-3 py-2 text-xs opacity-30 cursor-default"
    >
      Open in new tab
    </button>
    <button
      disabled
      className="w-full text-left px-3 py-2 text-xs opacity-30 cursor-default"
    >
      Open in split pane
    </button>
    <div className="my-1 border-t border-idemora-border" />
    {closedTabs.length === 0 ? (
      <button disabled className="w-full text-left px-3 py-2 text-xs opacity-30 cursor-default">
        No recently closed tabs
      </button>
    ) : (
      <>
        <div className="px-3 py-1 text-[10px] text-idemora-text-faint uppercase tracking-wider">Recently closed</div>
        {[...closedTabs].reverse().map((ct, i) => {
          const note = notes.find((n) => n.id === ct.noteId);
          return (
            <button
              key={i}
              onClick={() => {
                const state = useUIStore.getState();
                const idx = closedTabs.length - 1 - i;
                // reopen specific tab by splicing it to the end then calling reopenClosedTab
                const reordered = [...closedTabs.filter((_, j) => j !== idx), closedTabs[idx]];
                state.clearSelection?.();
                useUIStore.setState({ closedTabs: reordered });
                state.reopenClosedTab();
                setEmptySpaceMenu(null);
              }}
              className="w-full text-left px-3 py-2 text-xs hover:bg-black/4 dark:hover:bg-white/4 truncate"
            >
              {note?.title ?? "Untitled"}
            </button>
          );
        })}
      </>
    )}
  </div>
)}
    </div>
  );
}