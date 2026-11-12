// src/features/sync/components/CopyDiagnosticsButton.tsx
//
// Stage 4d.3, step 14, Phase B2.3. The "Copy diagnostics" button. Presentational: the
// numbers are read and the text is built by collectDiagnostics (diagnosticsLive.ts, which
// calls the pure buildDiagnostics in diagnostics.ts). The text has no note text and no
// titles. If the clipboard is not available the text is shown so it can be copied by hand.
//
// Step 5 (UI/UX refactor), slice 1: variant "row" renders as a whole-row button for the
// Sync screen. The default "link" variant (used on the review screens) is unchanged.

import { useState } from "react";
import {
  collectDiagnostics,
  copyText,
  type OutcomeShape,
  type ReviewLike,
} from "@/features/sync/lib/diagnosticsLive";
import { SyncIcons, SyncRow } from "@/features/sync/components/SyncRow";

interface Props {
  /** Leave out for the Sync panel (app and queue numbers only). */
  noteId?: string;
  review?: ReviewLike | null;
  outcome?: OutcomeShape | null;
  variant?: "link" | "row";
}

export function CopyDiagnosticsButton({ noteId, review, outcome, variant = "link" }: Props) {
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState<"idle" | "copied" | "manual">("idle");
  const [manualText, setManualText] = useState("");

  async function run() {
    setRunning(true);
    try {
      const text = await collectDiagnostics({ noteId: noteId ?? undefined, review, outcome });
      if (await copyText(text)) {
        setStatus("copied");
        setManualText("");
      } else {
        setStatus("manual");
        setManualText(text);
      }
    } finally {
      setRunning(false);
    }
  }

  // A fresh click is a valid gesture for the clipboard, so this usually works
  // even when the first automatic copy was refused or came too late.
  async function copyAgain() {
    if (await copyText(manualText)) {
      setStatus("copied");
      setManualText("");
    }
  }

  const hint = "Copies numbers and status words only. No note text or titles.";

  if (variant === "row") {
    const description = running
      ? "Collecting…"
      : status === "copied"
        ? "Copied to the clipboard."
        : "Numbers and status words only. No note text or titles.";
    return (
      <div>
        <SyncRow
          icon={SyncIcons.copy}
          title="Copy diagnostics"
          description={description}
          hint={hint}
          disabled={running}
          onClick={() => void run()}
        />
        {status === "manual" && (
          <div className="mt-2 text-xs text-idemora-text-muted">
            Could not copy automatically.{" "}
            <button onClick={() => void copyAgain()} className="underline hover:text-idemora-text-normal">
              Copy
            </button>
            <details className="mt-1">
              <summary className="cursor-pointer">Show the text</summary>
              <textarea
                readOnly
                value={manualText}
                onFocus={(e) => e.currentTarget.select()}
                className="mt-1 block h-24 w-full resize-none rounded border border-idemora-border bg-transparent p-1 font-mono text-[10px] text-idemora-text-normal"
              />
            </details>
          </div>
        )}
      </div>
    );
  }

  return (
    <span className="inline-block">
      <button
        onClick={() => void run()}
        disabled={running}
        title={hint}
        className="text-xs underline text-idemora-text-muted hover:text-idemora-text-normal disabled:opacity-50"
      >
        {running ? "Collecting…" : "Copy diagnostics"}
      </button>
      {status === "copied" && <span className="ml-2 text-xs text-green-600">Copied</span>}
      {status === "manual" && (
        <span className="mt-1 block text-xs text-idemora-text-muted">
          Could not copy automatically.{" "}
          <button onClick={() => void copyAgain()} className="underline hover:text-idemora-text-normal">
            Copy
          </button>
          <details className="mt-1">
            <summary className="cursor-pointer">Show the text</summary>
            <textarea
              readOnly
              value={manualText}
              onFocus={(e) => e.currentTarget.select()}
              className="mt-1 block h-24 w-full resize-none rounded border border-idemora-border bg-transparent p-1 font-mono text-[10px] text-idemora-text-normal"
            />
          </details>
        </span>
      )}
    </span>
  );
}
