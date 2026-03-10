// src/components/Editor/Toolbar.tsx
import type { Editor } from "@tiptap/react";

interface Props {
  editor: Editor | null;
}

export function Toolbar({ editor }: Props) {
  if (!editor) return null;

  return (
    <div className="
      flex items-center gap-0.5 px-4 py-1.5 shrink-0
      border-b border-zinc-200 dark:border-zinc-800
      bg-zinc-50 dark:bg-zinc-900
    ">
      <ToolGroup>
        <ToolButton
          onClick={() => editor.chain().focus().toggleBold().run()}
          active={editor.isActive("bold")}
          title="Bold (Ctrl+B)"
        >
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
            <path d="M3 2h4.5a2.5 2.5 0 010 5H3V2zM3 7h5a2.5 2.5 0 010 5H3V7z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/>
          </svg>
        </ToolButton>
        <ToolButton
          onClick={() => editor.chain().focus().toggleItalic().run()}
          active={editor.isActive("italic")}
          title="Italic (Ctrl+I)"
        >
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
            <path d="M5 2h5M3 11h5M7.5 2l-3 9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
          </svg>
        </ToolButton>
        <ToolButton
          onClick={() => editor.chain().focus().toggleStrike().run()}
          active={editor.isActive("strike")}
          title="Strikethrough"
        >
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
            <path d="M2 6.5h9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
            <path d="M4.5 4C4.5 2.9 5.4 2 6.5 2s2 .9 2 2c0 .8-.5 1.3-1 1.7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
            <path d="M8.5 9c0 1.1-.9 2-2 2s-2-.9-2-2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
          </svg>
        </ToolButton>
        <ToolButton
          onClick={() => editor.chain().focus().toggleCode().run()}
          active={editor.isActive("code")}
          title="Inline code"
        >
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
            <path d="M4.5 3.5L1 6.5l3.5 3M8.5 3.5L12 6.5l-3.5 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </ToolButton>
      </ToolGroup>

      <Divider />

      <ToolGroup>
        <ToolButton
          onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
          active={editor.isActive("heading", { level: 1 })}
          title="Heading 1"
        >
          <span className="text-[11px] font-bold leading-none">H1</span>
        </ToolButton>
        <ToolButton
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
          active={editor.isActive("heading", { level: 2 })}
          title="Heading 2"
        >
          <span className="text-[11px] font-bold leading-none">H2</span>
        </ToolButton>
        <ToolButton
          onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
          active={editor.isActive("heading", { level: 3 })}
          title="Heading 3"
        >
          <span className="text-[11px] font-bold leading-none">H3</span>
        </ToolButton>
      </ToolGroup>

      <Divider />

      <ToolGroup>
        <ToolButton
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          active={editor.isActive("bulletList")}
          title="Bullet list"
        >
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
            <circle cx="2" cy="3.5" r="1" fill="currentColor"/>
            <circle cx="2" cy="6.5" r="1" fill="currentColor"/>
            <circle cx="2" cy="9.5" r="1" fill="currentColor"/>
            <path d="M5 3.5h6M5 6.5h6M5 9.5h6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
          </svg>
        </ToolButton>
        <ToolButton
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          active={editor.isActive("orderedList")}
          title="Numbered list"
        >
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
            <path d="M1.5 2v3M1 4.5h1.5" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round"/>
            <path d="M1 8h1.5l-1.5 2H3" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M5 3.5h6M5 6.5h6M5 9.5h6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
          </svg>
        </ToolButton>
        <ToolButton
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
          active={editor.isActive("blockquote")}
          title="Blockquote"
        >
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
            <path d="M2 3h2v4H2V3zm5 0h2v4H7V3zM4 7c0 1.1-.9 2-2 2M9 7c0 1.1-.9 2-2 2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </ToolButton>
        <ToolButton
          onClick={() => editor.chain().focus().toggleCodeBlock().run()}
          active={editor.isActive("codeBlock")}
          title="Code block"
        >
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
            <rect x="1" y="2" width="11" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.2"/>
            <path d="M4 5.5L2.5 6.5 4 7.5M9 5.5l1.5 1-1.5 1M6.5 4.5l-1 4" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </ToolButton>
      </ToolGroup>

      <Divider />

      <ToolGroup>
        <ToolButton
          onClick={() => editor.chain().focus().setHorizontalRule().run()}
          active={false}
          title="Horizontal rule"
        >
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
            <path d="M1 6.5h11" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
          </svg>
        </ToolButton>
        <ToolButton
          onClick={() => editor.chain().focus().undo().run()}
          active={false}
          title="Undo (Ctrl+Z)"
          disabled={!editor.can().undo()}
        >
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
            <path d="M2 5H7a3 3 0 010 6H4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M2 2.5V5H4.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </ToolButton>
        <ToolButton
          onClick={() => editor.chain().focus().redo().run()}
          active={false}
          title="Redo (Ctrl+Y)"
          disabled={!editor.can().redo()}
        >
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
            <path d="M11 5H6a3 3 0 000 6h3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M11 2.5V5H8.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </ToolButton>
      </ToolGroup>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ToolGroup({ children }: { children: React.ReactNode }) {
  return <div className="flex items-center gap-0.5">{children}</div>;
}

function Divider() {
  return (
    <div className="w-px h-4 bg-zinc-200 dark:bg-zinc-700 mx-1 shrink-0" />
  );
}

function ToolButton({
  onClick,
  active,
  title,
  disabled = false,
  children,
}: {
  onClick: () => void;
  active: boolean;
  title: string;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      disabled={disabled}
      className={`
        w-7 h-7 flex items-center justify-center rounded-md
        transition-colors duration-75
        disabled:opacity-30 disabled:cursor-not-allowed
        ${active
          ? "bg-zinc-200 dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100"
          : "text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-800 dark:hover:text-zinc-200"
        }
      `}
    >
      {children}
    </button>
  );
}