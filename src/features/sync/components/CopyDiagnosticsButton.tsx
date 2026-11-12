// src/features/sync/components/CopyDiagnosticsButton.tsx
//
// Stage 4d.3, step 14, Phase B2.3. The "Copy diagnostics" button. Presentational: the
// numbers are read and the text is built by collectDiagnostics (diagnosticsLive.ts, which
// calls the pure buildDiagnostics in diagnostics.ts). The text has no note text and no
// titles. If the clipboard is not available the text is shown so it can be copied by hand.

import { useState } from "react";
import {
  collectDiagnostics,
  copyText,
  type OutcomeShape,
  type ReviewLike,
} from "@/features/sync/lib/diagnosticsLive";

interface Props {
  /** Leave out for the Sync panel (app and queue numbers only). */
  noteId?: string;
  review?: ReviewLike | null;
  outcome?: OutcomeShape | null;
}

export function CopyDiagnosticsButton({ noteId, review, outcome }: Props) {
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

  return (
    <span className="inline-block">
      <button
        onClick={() => void run()}
        disabled={running}
        title="Copies numbers and status words only. No note text or titles."
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
