// src/features/ui/components/TemplatePickerModal.tsx
import { useEffect, useRef, useState } from "react";
import { TEMPLATES, type Template } from "@/lib/templates";

const COLS = 3;

interface Props {
  open: boolean;
  onSelect: (template: Template) => void;
  onCancel: () => void;
}

export function TemplatePickerModal({ open, onSelect, onCancel }: Props) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const buttonRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const selectedIndexRef = useRef(0);
  const onSelectRef = useRef(onSelect);
  const onCancelRef = useRef(onCancel);

  useEffect(() => { onSelectRef.current = onSelect; }, [onSelect]);
  useEffect(() => { onCancelRef.current = onCancel; }, [onCancel]);
  useEffect(() => { selectedIndexRef.current = selectedIndex; }, [selectedIndex]);

  useEffect(() => {
    if (open) setSelectedIndex(0);
  }, [open]);

  useEffect(() => {
    buttonRefs.current[selectedIndex]?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  useEffect(() => {
    if (!open) return;

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onCancelRef.current();
        return;
      }
      if (e.key === "ArrowRight") {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, TEMPLATES.length - 1));
      }
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + COLS, TEMPLATES.length - 1));
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - COLS, 0));
      }
      if (e.key === "Enter") {
        e.preventDefault();
        onSelectRef.current(TEMPLATES[selectedIndexRef.current]);
      }
    }

    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 dark:bg-black/50 backdrop-blur-sm"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-lg mx-4 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-zinc-100 dark:border-zinc-800">
          <div>
            <h2 className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">New note</h2>
            <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-0.5">Choose a starting point</p>
          </div>
          <button
            onClick={onCancel}
            className="w-7 h-7 flex items-center justify-center rounded-md text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors duration-100"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </button>
        </div>

        {/* Template grid */}
        <div className="p-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {TEMPLATES.map((template, i) => (
            <button
              key={template.id}
              ref={(el) => { buttonRefs.current[i] = el; }}
              onClick={() => onSelect(template)}
              onMouseEnter={() => setSelectedIndex(i)}
              className={`group flex flex-col gap-2 p-3.5 rounded-lg border text-left transition-all duration-100 ${
                i === selectedIndex
                  ? "bg-white dark:bg-zinc-800 border-zinc-300 dark:border-zinc-600 shadow-sm"
                  : "bg-zinc-50 dark:bg-zinc-800/50 border-zinc-200 dark:border-zinc-700"
              }`}
            >
              <span className="text-xl leading-none select-none">{template.icon}</span>
              <div>
                <p className={`text-xs font-semibold transition-colors duration-100 ${
                  i === selectedIndex
                    ? "text-zinc-900 dark:text-zinc-100"
                    : "text-zinc-700 dark:text-zinc-300"
                }`}>
                  {template.label}
                </p>
                <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-0.5 leading-snug">
                  {template.description}
                </p>
              </div>
            </button>
          ))}
        </div>

        {/* Footer */}
        <div className="px-5 pb-4 flex items-center justify-end gap-3">
          <span className="text-[10px] text-zinc-300 dark:text-zinc-700 flex items-center gap-1">
            <kbd className="bg-zinc-100 dark:bg-zinc-800 text-zinc-400 dark:text-zinc-500 px-1 py-0.5 rounded font-mono">↑↓←→</kbd>
            navigate
          </span>
          <span className="text-[10px] text-zinc-300 dark:text-zinc-700 flex items-center gap-1">
            <kbd className="bg-zinc-100 dark:bg-zinc-800 text-zinc-400 dark:text-zinc-500 px-1 py-0.5 rounded font-mono">↵</kbd>
            select
          </span>
          <span className="text-[10px] text-zinc-300 dark:text-zinc-700 flex items-center gap-1">
            <kbd className="bg-zinc-100 dark:bg-zinc-800 text-zinc-400 dark:text-zinc-500 px-1 py-0.5 rounded font-mono">ESC</kbd>
            cancel
          </span>
        </div>
      </div>
    </div>
  );
}