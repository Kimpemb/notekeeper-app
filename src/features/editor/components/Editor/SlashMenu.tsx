// src/components/Editor/SlashMenu.tsx
import { useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";

interface Props {
  position: { top: number; left: number; caretTop: number };
  editor: Editor;
  query?: string;
  onCommand: (action: () => void) => void;
  onClose: () => void;
}

interface Command {
  id: string;
  label: string;
  description: string;
  icon: React.ReactNode;
  action: () => void;
}

export function SlashMenu({ position, editor, query = "", onCommand, onClose }: Props) {
  const menuRef  = useRef<HTMLDivElement>(null);
  const listRef  = useRef<HTMLUListElement>(null);
  const itemRefs = useRef<(HTMLLIElement | null)[]>([]);
  const [selected, setSelected] = useState(0);

  const commands: Command[] = [
    {
      id: "callout-info",
      label: "Info Callout",
      description: "Blue info callout block — callout, info, note",
      icon: <span className="text-base">💡</span>,
      action: () => editor.chain().focus().insertContent({
        type: "callout",
        attrs: { type: "info" },
        content: [{ type: "paragraph" }],
      }).run(),
    },
    {
      id: "callout-warning",
      label: "Warning Callout",
      description: "Amber warning callout block — warning, caution",
      icon: <span className="text-base">⚠️</span>,
      action: () => editor.chain().focus().insertContent({
        type: "callout",
        attrs: { type: "warning" },
        content: [{ type: "paragraph" }],
      }).run(),
    },
    {
      id: "callout-tip",
      label: "Tip Callout",
      description: "Green tip callout block — tip, success",
      icon: <span className="text-base">✅</span>,
      action: () => editor.chain().focus().insertContent({
        type: "callout",
        attrs: { type: "tip" },
        content: [{ type: "paragraph" }],
      }).run(),
    },
    {
      id: "callout-danger",
      label: "Danger Callout",
      description: "Red danger callout block — danger, error",
      icon: <span className="text-base">🚨</span>,
      action: () => editor.chain().focus().insertContent({
        type: "callout",
        attrs: { type: "danger" },
        content: [{ type: "paragraph" }],
      }).run(),
    },
    {
      id: "todo",
      label: "To-do List",
      description: "Checklist with checkboxes — todo, task",
      icon: (
        <svg width="15" height="15" viewBox="0 0 12 12" fill="none">
          <rect x="1" y="1.5" width="3.5" height="3.5" rx="0.75" stroke="currentColor" strokeWidth="1.1"/>
          <path d="M1.75 3.25l0.9 0.9 1.35-1.35" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round"/>
          <rect x="1" y="7" width="3.5" height="3.5" rx="0.75" stroke="currentColor" strokeWidth="1.1"/>
          <path d="M6.5 3.25h4M6.5 8.75h4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
        </svg>
      ),
      action: () => editor.chain().focus().toggleTaskList().run(),
    },
    {
      id: "h1",
      label: "Heading 1",
      description: "Large section heading",
      icon: <span className="font-bold text-base">H1</span>,
      action: () => editor.chain().focus().toggleHeading({ level: 1 }).run(),
    },
    {
      id: "h2",
      label: "Heading 2",
      description: "Medium section heading",
      icon: <span className="font-bold text-base">H2</span>,
      action: () => editor.chain().focus().toggleHeading({ level: 2 }).run(),
    },
    {
      id: "h3",
      label: "Heading 3",
      description: "Small section heading",
      icon: <span className="font-bold text-base">H3</span>,
      action: () => editor.chain().focus().toggleHeading({ level: 3 }).run(),
    },
    {
      id: "bullet",
      label: "Bullet List",
      description: "Unordered list of items",
      icon: (
        <svg width="15" height="15" viewBox="0 0 12 12" fill="none">
          <circle cx="2" cy="3" r="1" fill="currentColor"/>
          <circle cx="2" cy="6" r="1" fill="currentColor"/>
          <circle cx="2" cy="9" r="1" fill="currentColor"/>
          <path d="M5 3h6M5 6h6M5 9h6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
        </svg>
      ),
      action: () => editor.chain().focus().toggleBulletList().run(),
    },
    {
      id: "ordered",
      label: "Numbered List",
      description: "Ordered list of items",
      icon: (
        <svg width="15" height="15" viewBox="0 0 12 12" fill="none">
          <path d="M1.5 1.5v3M1 4h2" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round"/>
          <path d="M1 7h2l-2 2.5H3" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round"/>
          <path d="M5 3h6M5 6h6M5 9h6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
        </svg>
      ),
      action: () => editor.chain().focus().toggleOrderedList().run(),
    },
    {
      id: "blockquote",
      label: "Blockquote",
      description: "Highlighted quote or callout",
      icon: (
        <svg width="15" height="15" viewBox="0 0 12 12" fill="none">
          <path d="M2 3h2v3H2V3zm4 0h2v3H6V3zM4 6c0 1-.9 2-2 2M8 6c0 1-.9 2-2 2"
            stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      ),
      action: () => editor.chain().focus().toggleBlockquote().run(),
    },
    {
      id: "code",
      label: "Code Block",
      description: "Multiline code snippet",
      icon: (
        <svg width="15" height="15" viewBox="0 0 12 12" fill="none">
          <rect x="1" y="1.5" width="10" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.1"/>
          <path d="M3.5 5L2 6l1.5 1M8.5 5L10 6l-1.5 1M5.5 4l-1 4"
            stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      ),
      action: () => editor.chain().focus().toggleCodeBlock().run(),
    },
    {
      id: "divider",
      label: "Divider",
      description: "Horizontal rule",
      icon: (
        <svg width="15" height="15" viewBox="0 0 12 12" fill="none">
          <path d="M1 6h10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
        </svg>
      ),
      action: () => editor.chain().focus().setHorizontalRule().run(),
    },
  ];

  const filtered = query.trim()
    ? commands.filter(
        (c) =>
          c.label.toLowerCase().includes(query.toLowerCase()) ||
          c.id.toLowerCase().includes(query.toLowerCase()) ||
          c.description.toLowerCase().includes(query.toLowerCase())
      )
    : commands;

  useEffect(() => { setSelected(0); }, [query]);

  useEffect(() => {
    itemRefs.current[selected]?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selected]);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "ArrowDown") {
        e.preventDefault(); e.stopPropagation();
        setSelected((s) => Math.min(s + 1, filtered.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault(); e.stopPropagation();
        setSelected((s) => Math.max(s - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault(); e.stopPropagation();
        const cmd = filtered[selected];
        if (cmd) onCommand(cmd.action);
      }
    }
    document.addEventListener("keydown", handleKey, true);
    return () => document.removeEventListener("keydown", handleKey, true);
  }, [filtered, selected, onCommand]);

  useEffect(() => {
    function handleMouseDown(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [onClose]);

  const MENU_MAX_H = 300;
  const flip = position.top + MENU_MAX_H > window.innerHeight;

  return (
    <div
      ref={menuRef}
      style={{
        position: "fixed",
        left: Math.min(position.left, window.innerWidth - 260),
        ...(flip
          ? { bottom: window.innerHeight - position.caretTop }
          : { top: position.top }),
        zIndex: 50,
      }}
      className="w-64 rounded-xl overflow-hidden bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 shadow-2xl"
    >
      {query && (
        <div className="px-3 py-2 border-b border-zinc-100 dark:border-zinc-800">
          <span className="text-xs text-zinc-400">Filter: </span>
          <span className="text-xs font-medium text-zinc-600 dark:text-zinc-300">{query}</span>
        </div>
      )}

      <ul ref={listRef} className="py-1.5 max-h-72 overflow-y-auto">
        {filtered.length === 0 && (
          <li className="px-4 py-4 text-sm text-zinc-400 text-center">No commands match</li>
        )}
        {filtered.map((cmd, i) => (
          <li
            key={cmd.id}
            ref={(el) => { itemRefs.current[i] = el; }}
            onMouseEnter={() => setSelected(i)}
            onMouseDown={(e) => { e.preventDefault(); onCommand(cmd.action); }}
            className={`flex items-center gap-3 px-3 py-2.5 cursor-pointer transition-colors duration-75 ${
              i === selected
                ? "bg-zinc-100 dark:bg-zinc-800"
                : "hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
            }`}
          >
            <span className="w-8 h-8 flex items-center justify-center rounded-md shrink-0 bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300">
              {cmd.icon}
            </span>
            <div className="min-w-0">
              <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">{cmd.label}</p>
              <p className="text-xs text-zinc-400 dark:text-zinc-500 truncate">{cmd.description}</p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}