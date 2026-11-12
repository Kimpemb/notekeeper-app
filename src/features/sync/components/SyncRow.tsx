// src/features/sync/components/SyncRow.tsx
//
// Step 5 (sync UI/UX refactor), slice 1. Shared look for the Sync settings screen: a
// whole-row button (icon, title, one-line description, optional count badge and chevron),
// a count badge, the two button styles and the few icons. Presentational only.

import type { ReactNode } from "react";

// Same hover token as SettingsModal's H (kept local: SettingsModal does not export it).
export const ROW_HOVER = "hover:bg-black/[0.06] dark:hover:bg-white/[0.07]";

export const BTN_PRIMARY =
  "rounded-md bg-blue-500 px-3 py-1.5 text-sm font-medium text-white transition-colors duration-150 hover:bg-blue-600 disabled:opacity-50";

export const BTN_SECONDARY = `rounded-md border border-idemora-border px-3 py-1.5 text-sm text-idemora-text-normal transition-colors duration-150 ${ROW_HOVER} disabled:opacity-50`;

export const BTN_GHOST = `rounded-md px-2 py-1 text-sm text-idemora-text-muted transition-colors duration-150 hover:text-idemora-text-normal ${ROW_HOVER} disabled:opacity-50`;

// Same look as the sign-in form's input, without w-full (for inline search boxes and selects).
export const INPUT_COMPACT =
  "rounded-md border border-idemora-border bg-idemora-bg-secondary px-3 py-1.5 text-sm text-idemora-text-normal outline-none focus:border-blue-500";

export const SyncIcons = {
  review: (
    <svg width="16" height="16" viewBox="0 0 14 14" fill="none">
      <path d="M2.5 3.5h9M2.5 7h9M2.5 10.5h5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  ),
  backups: (
    <svg width="16" height="16" viewBox="0 0 14 14" fill="none">
      <rect x="2" y="2.5" width="10" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
      <path d="M2 5.5h10" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  ),
  copy: (
    <svg width="16" height="16" viewBox="0 0 14 14" fill="none">
      <rect x="4.5" y="4.5" width="7" height="7" rx="1.2" stroke="currentColor" strokeWidth="1.2" />
      <path
        d="M9.5 4.5V3.2A1.2 1.2 0 0 0 8.3 2H3.2A1.2 1.2 0 0 0 2 3.2v5.1A1.2 1.2 0 0 0 3.2 9.5h1.3"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
  ),
};

export function CountBadge({ count }: { count: number }) {
  return (
    <span className="shrink-0 rounded-full bg-blue-500 px-2 py-0.5 text-[11px] font-medium leading-none text-white">
      {count}
    </span>
  );
}

interface Props {
  icon: ReactNode;
  title: string;
  description?: string;
  onClick?: () => void;
  disabled?: boolean;
  /** Tooltip. */
  hint?: string;
  badge?: ReactNode;
  chevron?: boolean;
}

export function SyncRow({ icon, title, description, onClick, disabled, hint, badge, chevron }: Props) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={hint}
      className={`flex w-full items-center gap-3 rounded-lg border border-idemora-border px-3 py-2.5 text-left transition-colors duration-150 disabled:opacity-50 ${ROW_HOVER}`}
    >
      <span className="shrink-0 text-idemora-text-muted">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm leading-snug text-idemora-text-normal">{title}</span>
        {description && (
          <span className="block text-xs leading-snug text-idemora-text-muted">{description}</span>
        )}
      </span>
      {badge}
      {chevron && (
        <span className="shrink-0 text-idemora-text-muted">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path
              d="M4.5 2.5L8 6l-3.5 3.5"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      )}
    </button>
  );
}
