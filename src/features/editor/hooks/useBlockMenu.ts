// src/features/editor/hooks/useBlockMenu.ts
//
// Owns the block action menu and block highlight overlay.
// Called by useDragReorder at two trigger points:
//   - left click without drag (mouseup, thresholdMet === false)
//   - right click on handle (mousedown, button === 2)
//
// Nothing in here touches the drag loop or mouse movement.
// The only coupling back to useDragReorder is the three refs it receives:
//   handleRef       — to read handle position for menu placement
//   editorWrapRef   — to size the highlight overlay to the editor column

import { useRef, useCallback, useEffect } from "react";
import type { Editor } from "@tiptap/react";

// ── Constants ─────────────────────────────────────────────────────────────────

// Notion-style block selection blue — washed, not saturated
const BLOCK_HIGHLIGHT_BG      = "rgba(35, 131, 226, 0.14)";
const BLOCK_HIGHLIGHT_BG_DARK = "rgba(35, 131, 226, 0.20)";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface UseBlockMenuOptions {
  handleRef:      React.RefObject<HTMLDivElement | null>;
  editorWrapRef:  React.RefObject<HTMLDivElement | null>;
}

export interface UseBlockMenuResult {
  menuRef:     React.RefObject<HTMLDivElement | null>;
  menuOpenRef: React.RefObject<boolean>;
  openMenu:    (blockDom: HTMLElement, nodePos: number, editor: Editor) => void;
  closeMenu:   () => void;
}

interface MenuItem {
  label:     string;
  icon:      string;
  action:    (editor: Editor, nodePos: number, dom: HTMLElement) => void;
  danger?:   boolean;
  separator?: boolean; // draw a separator line before this item
}

// ── Menu item definitions ─────────────────────────────────────────────────────

const MENU_ITEMS: MenuItem[] = [
  {
    label: "Delete",
    icon: `<svg width="13" height="13" viewBox="0 0 13 13" fill="none">
      <path d="M2 3.5h9M5 3.5V2.5a.5.5 0 01.5-.5h2a.5.5 0 01.5.5v1M10.5 3.5l-.6 6.5a1 1 0 01-1 .9H4.1a1 1 0 01-1-.9L2.5 3.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`,
    danger: true,
    action: (editor, nodePos) => {
      const { state } = editor.view;
      const node = state.doc.nodeAt(nodePos);
      if (!node) return;

      // SubPage nodes must go through the trash flow with a confirm dialog.
      // Fire a custom event that SubPageNodeView listens for — it owns
      // trashNote and ConfirmModal, keeping this hook free of React state.
      if (node.type.name === "subPage") {
        const noteId = node.attrs.noteId as string | null;
        window.dispatchEvent(
          new CustomEvent("idemora:request-delete-subpage", {
            detail: {
              noteId,
              nodePos,
              // Callback so SubPageNodeView can dispatch the PM delete
              // only after the user confirms — editor ref stays here.
              deleteNode: () => {
                const { state: s } = editor.view;
                const n = s.doc.nodeAt(nodePos);
                if (!n) return;
                editor.view.dispatch(s.tr.delete(nodePos, nodePos + n.nodeSize));
              },
            },
          })
        );
        return;
      }

      editor.view.dispatch(state.tr.delete(nodePos, nodePos + node.nodeSize));
    },
  },
  {
    label: "Duplicate",
    icon: `<svg width="13" height="13" viewBox="0 0 13 13" fill="none">
      <rect x="4.5" y="4.5" width="7" height="7" rx="1.5" stroke="currentColor" stroke-width="1.2"/>
      <path d="M3 8.5H2a1 1 0 01-1-1V2a1 1 0 011-1h5.5a1 1 0 011 1v1" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
    </svg>`,
    action: (editor, nodePos) => {
      const { state } = editor.view;
      const node = state.doc.nodeAt(nodePos);
      if (!node) return;
      editor.view.dispatch(state.tr.insert(nodePos + node.nodeSize, node));
    },
  },
  {
    label: "Turn into",
    icon: `<svg width="13" height="13" viewBox="0 0 13 13" fill="none">
      <path d="M2 4h6M2 6.5h4M2 9h5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
      <path d="M10 3v7M10 10l-1.5-1.5M10 10l1.5-1.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`,
    action: (editor) => {
      // Focus editor and insert "/" to trigger the slash menu
      editor.chain().focus().run();
      editor.view.dispatch(editor.view.state.tr.insertText("/"));
    },
  },
  {
    label: "Copy link to block",
    icon: `<svg width="13" height="13" viewBox="0 0 13 13" fill="none">
      <path d="M5.5 7.5a3 3 0 004.2.1l1.5-1.5a3 3 0 00-4.2-4.2L6 2.9" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
      <path d="M7.5 5.5a3 3 0 00-4.2-.1L1.8 6.9a3 3 0 004.2 4.2L7 10.1" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
    </svg>`,
    separator: true,
    action: (_editor, _nodePos, dom) => {
      const blockId = dom.getAttribute("data-block-id") ?? "";
      const url = `${window.location.href.split("#")[0]}#block-${blockId}`;
      navigator.clipboard.writeText(url).catch(() => {});
    },
  },
  {
    label: "Move to",
    icon: `<svg width="13" height="13" viewBox="0 0 13 13" fill="none">
      <path d="M2 6.5h9M7.5 3L11 6.5 7.5 10" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`,
    action: () => {
      // Placeholder — wire to MoveNoteModal when ready
      console.log("Move to: not yet implemented");
    },
  },
  {
    label: "Comment",
    icon: `<svg width="13" height="13" viewBox="0 0 13 13" fill="none">
      <path d="M2 2.5h9a.5.5 0 01.5.5v5a.5.5 0 01-.5.5H7L4.5 11V8.5H2a.5.5 0 01-.5-.5V3a.5.5 0 01.5-.5z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>
    </svg>`,
    separator: true,
    action: () => {
      console.log("Comment: not yet implemented");
    },
  },
  {
    label: "Text colour",
    icon: `<svg width="13" height="13" viewBox="0 0 13 13" fill="none">
      <path d="M4 9.5L6.5 2.5 9 9.5M5 7.5h3" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
      <rect x="2" y="10.5" width="9" height="1.5" rx="0.75" fill="currentColor"/>
    </svg>`,
    separator: true,
    action: () => {
      console.log("Text colour: not yet implemented");
    },
  },
  {
    label: "Background colour",
    icon: `<svg width="13" height="13" viewBox="0 0 13 13" fill="none">
      <path d="M2.5 9L7 2.5l1.5 2.5M2.5 9L1 11l2-.5 7-7-1.5-1.5-7 7z" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"/>
      <rect x="2" y="10.5" width="9" height="1.5" rx="0.75" fill="currentColor" opacity="0.4"/>
    </svg>`,
    action: () => {
      console.log("Background colour: not yet implemented");
    },
  },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function isDarkMode(): boolean {
  return (
    document.documentElement.classList.contains("dark") ||
    window.matchMedia("(prefers-color-scheme: dark)").matches
  );
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useBlockMenu({
  handleRef,
  editorWrapRef,
}: UseBlockMenuOptions): UseBlockMenuResult {
  const menuRef      = useRef<HTMLDivElement | null>(null);
  const highlightRef = useRef<HTMLDivElement | null>(null);
  const menuOpenRef  = useRef<boolean>(false);

  // ── Mount: create owned DOM elements ─────────────────────────────────────
  useEffect(() => {
    // Block highlight overlay — sits behind the block, pointer-events:none
    const highlight = document.createElement("div");
    highlight.style.cssText = [
      "display:none",
      "position:fixed",
      "pointer-events:none",
      "z-index:10",
      "border-radius:3px",
      "opacity:0",
      "transition:opacity 120ms ease",
    ].join(";");
    document.body.appendChild(highlight);
    highlightRef.current = highlight;

    // Action menu
    const menu = document.createElement("div");
    menu.setAttribute("data-block-menu", "");
    menu.style.cssText = [
      "display:none",
      "position:fixed",
      "z-index:200",
      "min-width:200px",
      "border-radius:8px",
      "padding:4px",
      "user-select:none",
      "transform-origin:top left",
      "transition:opacity 120ms ease, transform 120ms ease",
    ].join(";");
    document.body.appendChild(menu);
    menuRef.current = menu;

    return () => {
      highlight.remove();
      menu.remove();
      highlightRef.current = null;
      menuRef.current      = null;
    };
  }, []);

  // ── closeMenu ─────────────────────────────────────────────────────────────
  const closeMenu = useCallback(() => {
    const menu      = menuRef.current;
    const highlight = highlightRef.current;

    if (menu) {
      menu.style.opacity   = "0";
      menu.style.transform = "scale(0.97) translateY(-2px)";
      setTimeout(() => {
        if (menuRef.current) menuRef.current.style.display = "none";
      }, 120);
    }

    if (highlight) {
      highlight.style.opacity = "0";
      setTimeout(() => {
        if (highlightRef.current) highlightRef.current.style.display = "none";
      }, 120);
    }

    // Remove active state from handle
    handleRef.current?.classList.remove("is-menu-open");

    menuOpenRef.current = false;
  }, [handleRef]);

  // ── openMenu ──────────────────────────────────────────────────────────────
  const openMenu = useCallback((blockDom: HTMLElement, nodePos: number, editor: Editor) => {
    const menu      = menuRef.current;
    const highlight = highlightRef.current;
    const handle    = handleRef.current;
    if (!menu || !highlight) return;

    menuOpenRef.current = true;
    handle?.classList.add("is-menu-open");

    const dark = isDarkMode();

    // ── Block highlight ─────────────────────────────────────────────────────
    const blockRect  = blockDom.getBoundingClientRect();
    const editorRect = editorWrapRef.current?.getBoundingClientRect();

    highlight.style.display    = "block";
    highlight.style.top        = `${blockRect.top - 2}px`;
    highlight.style.left       = `${editorRect ? editorRect.left : blockRect.left}px`;
    highlight.style.width      = `${editorRect ? editorRect.width : blockRect.width}px`;
    highlight.style.height     = `${blockRect.height + 4}px`;
    highlight.style.background = dark ? BLOCK_HIGHLIGHT_BG_DARK : BLOCK_HIGHLIGHT_BG;

    // Trigger fade-in (requires reflow first)
    highlight.getBoundingClientRect();
    highlight.style.opacity = "1";

    // ── Menu appearance ─────────────────────────────────────────────────────
    menu.style.background  = dark ? "#1c1c1e" : "#ffffff";
    menu.style.border      = `1px solid ${dark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.08)"}`;
    menu.style.boxShadow   = "0 4px 24px rgba(0,0,0,0.12),0 1px 4px rgba(0,0,0,0.06)";

    // ── Build menu items ────────────────────────────────────────────────────
    menu.innerHTML = "";

    for (const item of MENU_ITEMS) {
      if (item.separator) {
        const sep = document.createElement("div");
        sep.style.cssText = `height:1px;background:${dark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.07)"};margin:3px 0;`;
        menu.appendChild(sep);
      }

      const btn = document.createElement("button");
      btn.style.cssText = [
        "display:flex",
        "align-items:center",
        "gap:8px",
        "width:100%",
        "padding:5px 8px",
        "border:none",
        "background:transparent",
        "border-radius:5px",
        "font-size:13px",
        "line-height:1.4",
        "cursor:pointer",
        "text-align:left",
        "transition:background 80ms ease",
        item.danger
          ? `color:${dark ? "#f87171" : "#dc2626"}`
          : `color:${dark ? "#e4e4e7" : "#1c1c1e"}`,
      ].join(";");

      btn.innerHTML = `
        <span style="display:flex;align-items:center;opacity:${item.danger ? 1 : 0.55};flex-shrink:0">${item.icon}</span>
        <span>${item.label}</span>
      `;

      btn.addEventListener("mouseenter", () => {
        btn.style.background = dark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.05)";
      });
      btn.addEventListener("mouseleave", () => {
        btn.style.background = "transparent";
      });
      btn.addEventListener("mousedown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        item.action(editor, nodePos, blockDom);
        closeMenu();
      });

      menu.appendChild(btn);
    }

    // ── Position menu ───────────────────────────────────────────────────────
    menu.style.display   = "block";
    menu.style.opacity   = "0";
    menu.style.transform = "scale(0.97) translateY(-2px)";

    // Measure after display:block so we have real dimensions
    requestAnimationFrame(() => {
      const menuRect   = menu.getBoundingClientRect();
      const handleRect = handle?.getBoundingClientRect();
      const vw         = window.innerWidth;
      const vh         = window.innerHeight;

      // Prefer left of handle; flip right if it would overflow viewport left
      let left = (handleRect?.left ?? blockRect.left) - menuRect.width - 6;
      if (left < 8) left = (handleRect?.right ?? blockRect.right) + 6;
      if (left + menuRect.width > vw - 8) left = vw - menuRect.width - 8;

      // Align top with block top; nudge up if it overflows bottom
      let top = blockRect.top;
      if (top + menuRect.height > vh - 8) top = vh - menuRect.height - 8;
      if (top < 8) top = 8;

      menu.style.top       = `${top}px`;
      menu.style.left      = `${left}px`;
      menu.style.opacity   = "1";
      menu.style.transform = "scale(1) translateY(0)";
    });
  }, [handleRef, editorWrapRef, closeMenu]);

  return { menuRef, menuOpenRef, openMenu, closeMenu };
}