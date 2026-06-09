// src/features/notes/components/Sidebar/searchUtils.tsx

export function snippetKind(snippet: string): "tag" | "frontmatter" | "text" {
  if (snippet.startsWith("Tag: ")) return "tag"
  if (/^[\w-]+: .+/.test(snippet) && snippet.includes(" · ")) return "frontmatter"
  return "text"
}

export function SnippetText({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g)
  return (
    <span>
      {parts.map((part, i) =>
        part.startsWith("**") && part.endsWith("**") ? (
          <mark
            key={i}
            className="bg-amber-100/50 text-amber-800 rounded px-0.5 not-italic font-medium"
          >
            {part.slice(2, -2)}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </span>
  )
}

export function TagIcon() {
  return (
    <svg width="9" height="10" viewBox="0 0 9 10" fill="none" className="shrink-0 mt-px">
      <path
        d="M1 3.5h7M1 6.5h7M3 1l-1 8M7 1l-1 8"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinecap="round"
      />
    </svg>
  )
}