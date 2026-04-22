// src/features/editor/hooks/useBlockMenu.ts
//
// Owns the block action menu and block highlight overlay.
// Called by useDragReorder at two trigger points:
//   - left click without drag  (mouseup, thresholdMet === false)
//   - right click on handle    (mousedown, button === 2)

import { useRef, useCallback, useEffect } from "react";
import type { Editor } from "@tiptap/react";

// ── Constants ──────────────────────────────────────────────────────────────────

const BLOCK_HIGHLIGHT_BG      = "rgba(35, 131, 226, 0.14)";
const BLOCK_HIGHLIGHT_BG_DARK = "rgba(35, 131, 226, 0.20)";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface UseBlockMenuOptions {
  handleRef:     React.RefObject<HTMLDivElement | null>;
  editorWrapRef: React.RefObject<HTMLDivElement | null>;
}

export interface UseBlockMenuResult {
  menuRef:     React.RefObject<HTMLDivElement | null>;
  menuOpenRef: React.RefObject<boolean>;
  openMenu:    (blockDom: HTMLElement, nodePos: number, editor: Editor) => void;
  closeMenu:   () => void;
}

interface SubMenuItem {
  label:  string;
  color?: string;
  action: (editor: Editor, nodePos: number) => void;
}

interface MenuItem {
  label:         string;
  icon:          string;
  danger?:       boolean;
  separator?:    boolean;
  hasSubmenu?:   boolean;
  submenuItems?: SubMenuItem[];
  action:        (editor: Editor, nodePos: number, dom: HTMLElement) => void;
}

// ── Colour palettes ────────────────────────────────────────────────────────────

const TEXT_COLOURS: SubMenuItem[] = [
  { label: "Default", action: (e) => e.chain().focus().unsetColor().run() },
  { label: "Red",     color: "#ef4444", action: (e) => e.chain().focus().setColor("#ef4444").run() },
  { label: "Orange",  color: "#f97316", action: (e) => e.chain().focus().setColor("#f97316").run() },
  { label: "Yellow",  color: "#eab308", action: (e) => e.chain().focus().setColor("#eab308").run() },
  { label: "Green",   color: "#22c55e", action: (e) => e.chain().focus().setColor("#22c55e").run() },
  { label: "Blue",    color: "#3b82f6", action: (e) => e.chain().focus().setColor("#3b82f6").run() },
  { label: "Purple",  color: "#a855f7", action: (e) => e.chain().focus().setColor("#a855f7").run() },
  { label: "Pink",    color: "#ec4899", action: (e) => e.chain().focus().setColor("#ec4899").run() },
  { label: "Gray",    color: "#6b7280", action: (e) => e.chain().focus().setColor("#6b7280").run() },
];

const BG_COLOURS: SubMenuItem[] = [
  { label: "None",   action: (e) => e.chain().focus().unsetHighlight().run() },
  { label: "Red",    color: "#fecaca", action: (e) => e.chain().focus().setHighlight({ color: "#fecaca" }).run() },
  { label: "Orange", color: "#fed7aa", action: (e) => e.chain().focus().setHighlight({ color: "#fed7aa" }).run() },
  { label: "Yellow", color: "#fef08a", action: (e) => e.chain().focus().setHighlight({ color: "#fef08a" }).run() },
  { label: "Green",  color: "#bbf7d0", action: (e) => e.chain().focus().setHighlight({ color: "#bbf7d0" }).run() },
  { label: "Blue",   color: "#bfdbfe", action: (e) => e.chain().focus().setHighlight({ color: "#bfdbfe" }).run() },
  { label: "Purple", color: "#e9d5ff", action: (e) => e.chain().focus().setHighlight({ color: "#e9d5ff" }).run() },
  { label: "Pink",   color: "#fbcfe8", action: (e) => e.chain().focus().setHighlight({ color: "#fbcfe8" }).run() },
  { label: "Gray",   color: "#e5e7eb", action: (e) => e.chain().focus().setHighlight({ color: "#e5e7eb" }).run() },
];

// ── Turn into: block conversion ────────────────────────────────────────────────

function convertBlock(
  editor: Editor,
  nodePos: number,
  typeName: string,
  attrs: Record<string, unknown> = {},
) {
  const { state } = editor.view;
  const node = state.doc.nodeAt(nodePos);
  if (!node) return;
  const nodeType = state.schema.nodes[typeName];
  if (!nodeType) return;
  const newNode = nodeType.create(attrs, node.content, node.marks);
  editor.view.dispatch(state.tr.replaceWith(nodePos, nodePos + node.nodeSize, newNode));
}

const TURN_INTO_ITEMS: SubMenuItem[] = [
  { label: "Paragraph",     action: (e, p) => convertBlock(e, p, "paragraph") },
  { label: "Heading 1",     action: (e, p) => convertBlock(e, p, "heading", { level: 1 }) },
  { label: "Heading 2",     action: (e, p) => convertBlock(e, p, "heading", { level: 2 }) },
  { label: "Heading 3",     action: (e, p) => convertBlock(e, p, "heading", { level: 3 }) },
  { label: "Bullet list",   action: (e) => e.chain().focus().toggleBulletList().run() },
  { label: "Numbered list", action: (e) => e.chain().focus().toggleOrderedList().run() },
  { label: "Todo",          action: (e) => e.chain().focus().toggleTaskList().run() },
  { label: "Code block",    action: (e) => e.chain().focus().toggleCodeBlock().run() },
  { label: "Quote",         action: (e) => e.chain().focus().toggleBlockquote().run() },
];

// ── Menu item definitions ──────────────────────────────────────────────────────

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

      if (node.type.name === "subPage") {
        const noteId = node.attrs.noteId as string | null;
        window.dispatchEvent(
          new CustomEvent("idemora:request-delete-subpage", {
            detail: {
              noteId,
              nodePos,
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
    hasSubmenu: true,
    submenuItems: TURN_INTO_ITEMS,
    action: () => {},
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
      if (!blockId) return;
      const base = window.location.href.split("#")[0];
      navigator.clipboard.writeText(`${base}#block-${blockId}`).catch(() => {});
    },
  },
  {
    label: "Move to",
    icon: `<svg width="13" height="13" viewBox="0 0 13 13" fill="none">
      <path d="M2 6.5h9M7.5 3L11 6.5 7.5 10" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`,
    action: (editor, nodePos) => {
      const { state } = editor.view;
      const node = state.doc.nodeAt(nodePos);
      if (!node) return;
      window.dispatchEvent(
        new CustomEvent("idemora:move-block", {
          detail: {
            nodePos,
            nodeSize: node.nodeSize,
            nodeJson: node.toJSON(),
            deleteFromSource: () => {
              const { state: s } = editor.view;
              const n = s.doc.nodeAt(nodePos);
              if (!n) return;
              editor.view.dispatch(s.tr.delete(nodePos, nodePos + n.nodeSize));
            },
          },
        })
      );
    },
  },
  {
    label: "Comment",
    icon: `<svg width="13" height="13" viewBox="0 0 13 13" fill="none">
      <path d="M2 2.5h9a.5.5 0 01.5.5v5a.5.5 0 01-.5.5H7L4.5 11V8.5H2a.5.5 0 01-.5-.5V3a.5.5 0 01.5-.5z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>
    </svg>`,
    separator: true,
    action: () => showToast("Comments coming soon"),
  },
  {
    label: "Text colour",
    icon: `<svg width="13" height="13" viewBox="0 0 13 13" fill="none">
      <path d="M4 9.5L6.5 2.5 9 9.5M5 7.5h3" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
      <rect x="2" y="10.5" width="9" height="1.5" rx="0.75" fill="currentColor"/>
    </svg>`,
    separator: true,
    hasSubmenu: true,
    submenuItems: TEXT_COLOURS,
    action: () => {},
  },
  {
    label: "Background colour",
    icon: `<svg width="13" height="13" viewBox="0 0 13 13" fill="none">
      <path d="M2.5 9L7 2.5l1.5 2.5M2.5 9L1 11l2-.5 7-7-1.5-1.5-7 7z" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"/>
      <rect x="2" y="10.5" width="9" height="1.5" rx="0.75" fill="currentColor" opacity="0.4"/>
    </svg>`,
    hasSubmenu: true,
    submenuItems: BG_COLOURS,
    action: () => {},
  },
];

// ── Toast (no React dependency) ────────────────────────────────────────────────

function showToast(message: string) {
  const existing = document.querySelector("[data-block-menu-toast]");
  if (existing) existing.remove();

  const toast = document.createElement("div");
  toast.setAttribute("data-block-menu-toast", "");
  toast.textContent = message;
  toast.style.cssText = [
    "position:fixed",
    "bottom:24px",
    "left:50%",
    "transform:translateX(-50%)",
    "z-index:9999",
    "padding:8px 14px",
    "border-radius:8px",
    "font-size:13px",
    "pointer-events:none",
    "background:rgba(30,30,32,0.92)",
    "color:#e4e4e7",
    "box-shadow:0 4px 16px rgba(0,0,0,0.18)",
    "opacity:1",
    "transition:opacity 200ms ease",
  ].join(";");

  document.body.appendChild(toast);
  setTimeout(() => { toast.style.opacity = "0"; }, 1800);
  setTimeout(() => { toast.remove(); }, 2000);
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function isDarkMode(): boolean {
  return (
    document.documentElement.classList.contains("dark") ||
    window.matchMedia("(prefers-color-scheme: dark)").matches
  );
}

// ── Hook ───────────────────────────────────────────────────────────────────────

export function useBlockMenu({
  handleRef,
  editorWrapRef,
}: UseBlockMenuOptions): UseBlockMenuResult {
  const menuRef      = useRef<HTMLDivElement | null>(null);
  const highlightRef = useRef<HTMLDivElement | null>(null);
  const menuOpenRef  = useRef<boolean>(false);
  const submenuRef   = useRef<HTMLDivElement | null>(null);

  // ── Mount ────────────────────────────────────────────────────────────────────
  useEffect(() => {
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

    const submenu = document.createElement("div");
    submenu.setAttribute("data-block-submenu", "");
    submenu.style.cssText = [
      "display:none",
      "position:fixed",
      "z-index:201",
      "min-width:160px",
      "border-radius:8px",
      "padding:4px",
      "user-select:none",
      "transition:opacity 100ms ease",
    ].join(";");
    document.body.appendChild(submenu);
    submenuRef.current = submenu;

    return () => {
      highlight.remove();
      menu.remove();
      submenu.remove();
      highlightRef.current = null;
      menuRef.current      = null;
      submenuRef.current   = null;
    };
  }, []);

  // ── closeSubmenu ─────────────────────────────────────────────────────────────
  const closeSubmenu = useCallback(() => {
    const sub = submenuRef.current;
    if (!sub) return;
    sub.style.opacity = "0";
    setTimeout(() => {
      if (submenuRef.current) submenuRef.current.style.display = "none";
    }, 100);
  }, []);

  // ── closeMenu ─────────────────────────────────────────────────────────────────
  const closeMenu = useCallback(() => {
    closeSubmenu();
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

    handleRef.current?.classList.remove("is-menu-open");
    menuOpenRef.current = false;
  }, [handleRef, closeSubmenu]);

  // ── showSubmenu ───────────────────────────────────────────────────────────────
  const showSubmenu = useCallback((
    items: SubMenuItem[],
    anchorBtn: HTMLElement,
    editor: Editor,
    nodePos: number,
    dark: boolean,
  ) => {
    const sub = submenuRef.current;
    if (!sub) return;

    sub.style.background = dark ? "#1c1c1e" : "#ffffff";
    sub.style.border     = `1px solid ${dark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.08)"}`;
    sub.style.boxShadow  = "0 4px 24px rgba(0,0,0,0.12),0 1px 4px rgba(0,0,0,0.06)";
    sub.innerHTML        = "";

    for (const item of items) {
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
        `color:${dark ? "#e4e4e7" : "#1c1c1e"}`,
      ].join(";");

      const swatch = item.color
        ? `<span style="width:12px;height:12px;border-radius:3px;background:${item.color};flex-shrink:0;border:1px solid rgba(0,0,0,0.12)"></span>`
        : `<span style="width:12px;height:12px;border-radius:3px;border:1.5px dashed ${dark ? "rgba(255,255,255,0.3)" : "rgba(0,0,0,0.25)"};flex-shrink:0"></span>`;

      btn.innerHTML = `${swatch}<span>${item.label}</span>`;

      btn.addEventListener("mouseenter", () => {
        btn.style.background = dark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.05)";
      });
      btn.addEventListener("mouseleave", () => {
        btn.style.background = "transparent";
      });
      btn.addEventListener("mousedown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        item.action(editor, nodePos);
        closeMenu();
      });

      sub.appendChild(btn);
    }

    sub.style.display = "block";
    sub.style.opacity = "0";

    requestAnimationFrame(() => {
      const btnRect = anchorBtn.getBoundingClientRect();
      const subRect = sub.getBoundingClientRect();
      const vw      = window.innerWidth;
      const vh      = window.innerHeight;

      let left = btnRect.right + 4;
      if (left + subRect.width > vw - 8) left = btnRect.left - subRect.width - 4;

      let top = btnRect.top;
      if (top + subRect.height > vh - 8) top = vh - subRect.height - 8;
      if (top < 8) top = 8;

      sub.style.left    = `${left}px`;
      sub.style.top     = `${top}px`;
      sub.style.opacity = "1";
    });
  }, [closeMenu]);

  // ── openMenu ──────────────────────────────────────────────────────────────────
  const openMenu = useCallback((blockDom: HTMLElement, nodePos: number, editor: Editor) => {
    const menu      = menuRef.current;
    const highlight = highlightRef.current;
    const handle    = handleRef.current;
    if (!menu || !highlight) return;

    menuOpenRef.current = true;
    handle?.classList.add("is-menu-open");

    const dark = isDarkMode();

    // Block highlight
    const blockRect  = blockDom.getBoundingClientRect();
    const editorRect = editorWrapRef.current?.getBoundingClientRect();

    highlight.style.display    = "block";
    highlight.style.top        = `${blockRect.top - 2}px`;
    highlight.style.left       = `${editorRect ? editorRect.left : blockRect.left}px`;
    highlight.style.width      = `${editorRect ? editorRect.width : blockRect.width}px`;
    highlight.style.height     = `${blockRect.height + 4}px`;
    highlight.style.background = dark ? BLOCK_HIGHLIGHT_BG_DARK : BLOCK_HIGHLIGHT_BG;
    highlight.getBoundingClientRect();
    highlight.style.opacity    = "1";

    // Menu shell
    menu.style.background = dark ? "#1c1c1e" : "#ffffff";
    menu.style.border     = `1px solid ${dark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.08)"}`;
    menu.style.boxShadow  = "0 4px 24px rgba(0,0,0,0.12),0 1px 4px rgba(0,0,0,0.06)";
    menu.innerHTML        = "";

    let activeSubmenuBtn: HTMLElement | null = null;

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

      const chevron = item.hasSubmenu
        ? `<svg style="margin-left:auto;opacity:0.4" width="10" height="10" viewBox="0 0 10 10" fill="none">
             <path d="M3.5 2L7 5l-3.5 3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
           </svg>`
        : "";

      btn.innerHTML = `
        <span style="display:flex;align-items:center;opacity:${item.danger ? 1 : 0.55};flex-shrink:0">${item.icon}</span>
        <span style="flex:1">${item.label}</span>
        ${chevron}
      `;

      btn.addEventListener("mouseenter", () => {
        btn.style.background = dark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.05)";

        if (item.hasSubmenu && item.submenuItems) {
          activeSubmenuBtn = btn;
          showSubmenu(item.submenuItems, btn, editor, nodePos, dark);
        } else {
          if (activeSubmenuBtn && activeSubmenuBtn !== btn) {
            closeSubmenu();
            activeSubmenuBtn = null;
          }
        }
      });

      btn.addEventListener("mouseleave", (e) => {
        btn.style.background = "transparent";
        // Don't close submenu if cursor is moving into it
        const related = e.relatedTarget as Node | null;
        if (submenuRef.current && related && submenuRef.current.contains(related)) return;
      });

      btn.addEventListener("mousedown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!item.hasSubmenu) {
          item.action(editor, nodePos, blockDom);
          closeMenu();
        }
      });

      menu.appendChild(btn);
    }

    // Close submenu when mouse leaves the menu (but not into submenu)
    menu.addEventListener("mouseleave", (e) => {
      const related = e.relatedTarget as Node | null;
      if (submenuRef.current && related && submenuRef.current.contains(related)) return;
      closeSubmenu();
      activeSubmenuBtn = null;
    });

    // Position menu
    menu.style.display   = "block";
    menu.style.opacity   = "0";
    menu.style.transform = "scale(0.97) translateY(-2px)";

    requestAnimationFrame(() => {
      const menuRect   = menu.getBoundingClientRect();
      const handleRect = handle?.getBoundingClientRect();
      const vw         = window.innerWidth;
      const vh         = window.innerHeight;

      let left = (handleRect?.left ?? blockRect.left) - menuRect.width - 6;
      if (left < 8) left = (handleRect?.right ?? blockRect.right) + 6;
      if (left + menuRect.width > vw - 8) left = vw - menuRect.width - 8;

      let top = blockRect.top;
      if (top + menuRect.height > vh - 8) top = vh - menuRect.height - 8;
      if (top < 8) top = 8;

      menu.style.top       = `${top}px`;
      menu.style.left      = `${left}px`;
      menu.style.opacity   = "1";
      menu.style.transform = "scale(1) translateY(0)";
    });
  }, [handleRef, editorWrapRef, closeMenu, closeSubmenu, showSubmenu]);

  return { menuRef, menuOpenRef, openMenu, closeMenu };
}