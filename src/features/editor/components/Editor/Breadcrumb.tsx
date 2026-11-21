// src/features/editor/components/Editor/Breadcrumb.tsx
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNoteStore } from "@/features/notes/store/useNoteStore";
import { useUIStore } from "@/features/ui/store/useUIStore";
import type { Note } from "@/types";

const MAX_ROWS = 5;       // rows shown in a menu before "N more"
const MENU_W = 260;
const COLLAPSE_OVER = 5;  // collapse the middle of the path when it has more crumbs than this

function getAncestors(noteId: string, noteMap: Map<string, Note>): Note[] {
  const out: Note[] = [];
  const seen = new Set<string>([noteId]);
  let cur = noteMap.get(noteId);
  while (cur) {
    const pid = cur.parent_id;
    if (!pid || seen.has(pid)) break;
    const parent = noteMap.get(pid);
    if (!parent) break;
    out.unshift(parent);
    seen.add(parent.id);
    cur = parent;
  }
  return out;
}

function DocIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" className="shrink-0 text-idemora-text-muted" aria-hidden="true">
      <path d="M3.5 1.5h5l3 3v9h-8z" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" />
      <path d="M8.5 1.5v3h3M5.5 8h4M5.5 10.5h4" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ChevronRight() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" className="shrink-0 text-idemora-text-faint" aria-hidden="true">
      <path d="M3.5 2L6.5 5L3.5 8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ── A menu of notes. Rows with children open a flyout (recursively). ─────────
interface MenuListProps {
  items: Note[];
  activeId: string | null;
  byParent: Map<string | null, Note[]>;
  onPick: (id: string) => void;
  flyouts: boolean;
  depthOf?: Map<string, number>; // row indent in levels, used by the hidden-path menu
}

function MenuList({ items, activeId, byParent, onPick, flyouts, depthOf }: MenuListProps) {
  const [expanded, setExpanded] = useState(false);
  const [sub, setSub] = useState<{ id: string; x: number; y: number } | null>(null);
  const timer = useRef(0);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const shown = expanded ? items : items.slice(0, MAX_ROWS);
  const more = items.length - shown.length;

  function hoverRow(e: React.MouseEvent<HTMLElement>, n: Note) {
    window.clearTimeout(timer.current);
    const hasKids = flyouts && (byParent.get(n.id)?.length ?? 0) > 0;
    const r = e.currentTarget.getBoundingClientRect();
    timer.current = window.setTimeout(() => {
      if (!hasKids) { setSub(null); return; }
      const flip = r.right + 8 + MENU_W > window.innerWidth - 8;
      const x = flip ? r.left - MENU_W - 8 : r.right + 8;
      const y = Math.max(8, Math.min(r.top - 8, window.innerHeight - 260));
      setSub({ id: n.id, x, y });
    }, 130);
  }

  return (
    <div className={`px-1.5 py-1.5 ${expanded ? "max-h-80 overflow-y-auto" : ""}`}>
      {shown.map((n) => {
        const kids = flyouts ? (byParent.get(n.id)?.length ?? 0) : 0;
        return (
          <button
            key={n.id}
            onClick={() => onPick(n.id)}
            onMouseEnter={(e) => hoverRow(e, n)}
            style={{ paddingLeft: 8 + (depthOf?.get(n.id) ?? 0) * 12 }}
            className={`flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-sm text-left text-idemora-text-normal transition-colors duration-100 ${
              n.id === activeId || sub?.id === n.id ? "bg-idemora-bg-secondary" : "hover:bg-idemora-bg-secondary"
            }`}
          >
            <DocIcon />
            <span className="flex-1 truncate">{n.title || "Untitled"}</span>
            {kids > 0 && <ChevronRight />}
          </button>
        );
      })}

      {more > 0 && (
        <button
          onClick={() => setExpanded(true)}
          onMouseEnter={() => { window.clearTimeout(timer.current); setSub(null); }}
          className="inline-block mt-0.5 px-2 py-1 rounded-md text-sm text-idemora-text-muted hover:text-idemora-text-normal hover:bg-idemora-bg-secondary transition-colors duration-100"
        >
          {more} more
        </button>
      )}

      {sub && (
        <div
          className="fixed z-[101] rounded-xl border border-idemora-border bg-idemora-bg-primary shadow-xl"
          style={{ left: sub.x, top: sub.y, width: MENU_W }}
        >
          <MenuList
            key={sub.id}
            items={byParent.get(sub.id) ?? []}
            activeId={activeId}
            byParent={byParent}
            onPick={onPick}
            flyouts={flyouts}
          />
        </div>
      )}
    </div>
  );
}

// ── The breadcrumb itself ────────────────────────────────────────────────────
type Pop =
  | { kind: "siblings"; noteId: string; x: number; y: number }
  | { kind: "hidden"; x: number; y: number };

type Item = { kind: "crumb"; note: Note } | { kind: "ellipsis" };

interface Props {
  noteId: string;
  paneId?: 1 | 2;
}

export const Breadcrumb = memo(({ noteId, paneId = 1 }: Props) => {
  const notes = useNoteStore((s) => s.notes);
  const setActive = useNoteStore((s) => s.setActiveNote);
  const replaceTab = useUIStore((s) => s.replaceTab);
  const replacePane2Tab = useUIStore((s) => s.replacePane2Tab);
  const expandNode = useUIStore((s) => s.expandNode);

  const noteMap = useMemo(() => new Map(notes.map((n) => [n.id, n])), [notes]);

  // children by parent id (null = top level), most recently modified first
  // (the sidebar's default order)
  const byParent = useMemo(() => {
    const m = new Map<string | null, Note[]>();
    for (const n of notes) {
      if (n.deleted_at) continue;
      const key = n.parent_id || null;
      const list = m.get(key);
      if (list) list.push(n);
      else m.set(key, [n]);
    }
    m.forEach((list) => list.sort((a, b) => b.updated_at - a.updated_at));
    return m;
  }, [notes]);

  const ancestors = useMemo(() => getAncestors(noteId, noteMap), [noteId, noteMap]);

  const [pop, setPop] = useState<Pop | null>(null);
  const openTimer = useRef(0);
  const closeTimer = useRef(0);

  useEffect(() => () => {
    window.clearTimeout(openTimer.current);
    window.clearTimeout(closeTimer.current);
  }, []);

  useEffect(() => { setPop(null); }, [noteId]);

  useEffect(() => {
    if (!pop) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setPop(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pop]);

  const go = useCallback(
    (id: string) => {
      setActive(id);
      if (paneId === 2) replacePane2Tab(id);
      else replaceTab(id);
      expandNode(id);
    },
    [paneId, setActive, replaceTab, replacePane2Tab, expandNode]
  );

  function show(el: HTMLElement, spec: { kind: "siblings"; noteId: string } | { kind: "hidden" }) {
    window.clearTimeout(closeTimer.current);
    window.clearTimeout(openTimer.current);
    const r = el.getBoundingClientRect();
    openTimer.current = window.setTimeout(() => {
      setPop({ ...spec, x: r.left, y: r.bottom + 6 });
    }, 120);
  }

  function scheduleClose() {
    window.clearTimeout(openTimer.current);
    closeTimer.current = window.setTimeout(() => setPop(null), 180);
  }

  function keepOpen() {
    window.clearTimeout(closeTimer.current);
  }

  const current = noteMap.get(noteId);
  if (ancestors.length === 0 || !current) return null;

  const crumbs = [...ancestors, current];
  const collapsed = crumbs.length > COLLAPSE_OVER;
  const hiddenCrumbs = collapsed ? crumbs.slice(1, crumbs.length - 3) : [];
  const hiddenDepth = new Map<string, number>(
    hiddenCrumbs.map((n, i): [string, number] => [n.id, i])
  );

  const items: Item[] = collapsed
    ? [
        { kind: "crumb", note: crumbs[0] },
        { kind: "ellipsis" },
        ...crumbs.slice(crumbs.length - 3).map((note): Item => ({ kind: "crumb", note })),
      ]
    : crumbs.map((note): Item => ({ kind: "crumb", note }));

  let menuItems: Note[] = [];
  if (pop?.kind === "siblings") {
    const n = noteMap.get(pop.noteId);
    menuItems = byParent.get(n?.parent_id || null) ?? [];
  } else if (pop?.kind === "hidden") {
    menuItems = hiddenCrumbs;
  }

  function pick(id: string) {
    setPop(null);
    if (id !== noteId) go(id);
  }

  return (
    <nav className="flex items-center overflow-hidden min-w-0" style={{ maxWidth: 560 }} aria-label="Breadcrumb">
      {items.map((it, i) => {
        const isLast = i === items.length - 1;
        return (
          <div
            key={it.kind === "crumb" ? it.note.id : "ellipsis"}
            className={`flex items-center min-w-0 ${
              it.kind === "ellipsis" ? "shrink-0" : isLast ? "shrink-0 max-w-[45%]" : "shrink min-w-[2.5rem]"
            }`}
          >
            {it.kind === "ellipsis" ? (
              <button
                onMouseEnter={(e) => show(e.currentTarget, { kind: "hidden" })}
                onMouseLeave={scheduleClose}
                className="text-base text-idemora-text-faint hover:text-idemora-text-muted transition-colors duration-100"
                aria-label="Show hidden path"
              >
                …
              </button>
            ) : (
              <button
                onClick={() => { if (!isLast) go(it.note.id); }}
                onMouseEnter={(e) => show(e.currentTarget, { kind: "siblings", noteId: it.note.id })}
                onMouseLeave={scheduleClose}
                className={`text-base truncate max-w-[180px] transition-colors duration-100 ${
                  isLast
                    ? "text-idemora-text-muted cursor-default"
                    : "text-idemora-text-faint hover:text-idemora-text-muted cursor-pointer"
                }`}
              >
                {it.note.title || "Untitled"}
              </button>
            )}
            {!isLast && <span className="mx-2 text-idemora-text-faint shrink-0">/</span>}
          </div>
        );
      })}

      {pop && menuItems.length > 0 && createPortal(
        <div
          className="fixed z-[100] rounded-xl border border-idemora-border bg-idemora-bg-primary shadow-xl"
          style={{ left: Math.max(8, Math.min(pop.x, window.innerWidth - MENU_W - 12)), top: pop.y, width: MENU_W }}
          onMouseEnter={keepOpen}
          onMouseLeave={scheduleClose}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <MenuList
            key={pop.kind === "siblings" ? pop.noteId : "hidden"}
            items={menuItems}
            activeId={pop.kind === "siblings" ? pop.noteId : null}
            byParent={byParent}
            onPick={pick}
            flyouts
            depthOf={pop.kind === "hidden" ? hiddenDepth : undefined}
          />
        </div>,
        document.body
      )}
    </nav>
  );
});

Breadcrumb.displayName = "Breadcrumb";