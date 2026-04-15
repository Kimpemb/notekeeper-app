// src/features/ui/components/ConfirmModal.tsx
import { useEffect, useRef } from "react";

interface Props {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmModal({
  open,
  title,
  message,
  confirmLabel = "Confirm",
  danger = false,
  onConfirm,
  onCancel,
}: Props) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") { e.preventDefault(); onCancel(); }
      if (e.key === "Enter")  { e.preventDefault(); onConfirm(); }
    }
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [open, onCancel, onConfirm]);

  useEffect(() => {
    if (!open) return;
    function onMouseDown(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) onCancel();
    }
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/30 /50 backdrop-blur-sm" />

      {/* Panel */}
      <div
        ref={panelRef}
        className="relative w-full max-w-sm mx-4 rounded-xl overflow-hidden bg-idemora-bg-primary border-idemora-border  shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b  border-idemora-border">
          <div className="flex items-center gap-2.5">
            {danger && (
              <div className="w-7 h-7 rounded-full bg-red-100 /50 flex items-center justify-center shrink-0">
                <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                  <path d="M6.5 2v4.5M6.5 9.5h.01" stroke="#ef4444" strokeWidth="1.6" strokeLinecap="round"/>
                  <circle cx="6.5" cy="6.5" r="5.5" stroke="#ef4444" strokeWidth="1.2"/>
                </svg>
              </div>
            )}
            <h2 className="text-base font-semibold text-idemora-text-normal">{title}</h2>
          </div>
          <button
            onClick={onCancel}
            className="w-7 h-7 flex items-center justify-center rounded-md text-idemora-text-muted     transition-colors duration-150"
          >
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
              <path d="M1 1l11 11M12 1L1 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4">
          <p className="text-sm text-idemora-text-muted leading-relaxed">{message}</p>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t  border-idemora-border">
          <button
            onClick={onCancel}
            className="px-4 py-2 rounded-lg text-sm text-idemora-text-muted     transition-colors duration-150"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors duration-150 ${
              danger
                ? "bg-red-500  text-idemora-text-normal"
                : "bg-idemora-bg-primary  text-idemora-text-normal   "
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}