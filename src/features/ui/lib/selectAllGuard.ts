// src/features/ui/lib/selectAllGuard.ts
//
// Ctrl/Cmd+A selects the whole page (buttons included) when focus is not in
// something editable. Block it there; leave it alone in inputs and the editor.
// Add data-allow-select-all to any other element that should keep the default.

interface TargetLike {
  tagName?: string;
  isContentEditable?: boolean;
  closest?: (selector: string) => unknown;
}

const ALLOW_SELECTOR = '[contenteditable="true"], .ProseMirror, [data-allow-select-all]';

export function isSelectAllAllowed(target: TargetLike | null): boolean {
  if (!target) return false;
  const tag = target.tagName?.toUpperCase();
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (target.isContentEditable) return true;
  return Boolean(target.closest?.(ALLOW_SELECTOR));
}

export function installSelectAllGuard(doc: Document = document): () => void {
  const onKeyDown = (e: KeyboardEvent) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
    if (e.key.toLowerCase() !== "a") return;
    if (isSelectAllAllowed(e.target as TargetLike | null)) return;
    e.preventDefault();
  };
  doc.addEventListener("keydown", onKeyDown);
  return () => doc.removeEventListener("keydown", onKeyDown);
}