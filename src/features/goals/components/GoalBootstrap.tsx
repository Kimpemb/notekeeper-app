// src/features/goals/components/GoalBootstrap.tsx

import { useState } from "react";
import { getAllNotes } from "@/features/notes/db/queries";
import { parseAndSyncFrontmatter } from "@/features/goals/lib/frontmatterGoalParser";

interface Candidate {
  id:    string;
  title: string;
  date:  string;
  status: string;
  checked: boolean;
}

interface Props {
  onDone: () => void;
}

export function GoalBootstrap({ onDone }: Props) {
  const [step,       setStep]       = useState<"idle" | "scanning" | "review" | "running" | "done">("idle");
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [summary,    setSummary]    = useState<{ created: number; linked: number } | null>(null);

  async function handleScan() {
    setStep("scanning");
    const notes = await getAllNotes();
    const found: Candidate[] = [];

    for (const note of notes) {
      if (!note.frontmatter) continue;
      try {
        const fm = JSON.parse(note.frontmatter) as Record<string, string>;
        if (fm["date"] && fm["status"]) {
          found.push({
            id:      note.id,
            title:   note.title,
            date:    fm["date"],
            status:  fm["status"],
            checked: true,
          });
        }
      } catch { continue; }
    }

    setCandidates(found);
    setStep("review");
  }

  function toggleCandidate(id: string) {
    setCandidates((prev) =>
      prev.map((c) => c.id === id ? { ...c, checked: !c.checked } : c)
    );
  }

  async function handleConfirm() {
    setStep("running");
    const notes = await getAllNotes();
    const noteMap = new Map(notes.map((n) => [n.id, n]));

    let linked  = 0;

    for (const candidate of candidates) {
      if (!candidate.checked) continue;
      const note = noteMap.get(candidate.id);
      if (!note) continue;
      await parseAndSyncFrontmatter(note.id, note.title, note.frontmatter ?? null);
      // We can't easily distinguish created vs linked from here,
      // so just count processed notes
      linked++;
    }

    setSummary({ created: 0, linked });
    setStep("done");
  }

  if (step === "idle") {
    return (
      <button
        onClick={handleScan}
        className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
      >
        Bootstrap goals from notes
      </button>
    );
  }

  if (step === "scanning") {
    return (
      <p className="text-xs text-idemora-text-faint">Scanning notes…</p>
    );
  }

  if (step === "review") {
    if (candidates.length === 0) {
      return (
        <div className="space-y-2">
          <p className="text-xs text-idemora-text-muted">
            No notes found with both <code>date</code> and <code>status</code> frontmatter fields.
          </p>
          <button
            onClick={onDone}
            className="text-xs text-idemora-text-faint hover:text-idemora-text-muted transition-colors"
          >
            Dismiss
          </button>
        </div>
      );
    }

    return (
      <div className="space-y-3">
        <p className="text-xs text-idemora-text-muted">
          {candidates.length} note{candidates.length !== 1 ? "s" : ""} can become goals.
          Uncheck any you want to skip.
        </p>
        <div className="space-y-1 max-h-48 overflow-y-auto">
          {candidates.map((c) => (
            <label
              key={c.id}
              className="flex items-center gap-2 py-1 cursor-pointer group"
            >
              <input
                type="checkbox"
                checked={c.checked}
                onChange={() => toggleCandidate(c.id)}
                className="accent-blue-500"
              />
              <span className="flex-1 text-xs text-idemora-text-normal truncate">
                {c.title}
              </span>
              <span className="text-xs text-idemora-text-faint shrink-0">
                {c.date} · {c.status}
              </span>
            </label>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleConfirm}
            disabled={candidates.filter((c) => c.checked).length === 0}
            className="text-xs px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-700
                       text-white disabled:opacity-50 transition-colors"
          >
            Create goals
          </button>
          <button
            onClick={onDone}
            className="text-xs text-idemora-text-muted hover:text-idemora-text-normal transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  if (step === "running") {
    return <p className="text-xs text-idemora-text-faint">Creating goals…</p>;
  }

  // done
  return (
    <div className="space-y-2">
      <p className="text-xs text-idemora-text-muted">
        Done — processed {summary?.linked ?? 0} note{(summary?.linked ?? 0) !== 1 ? "s" : ""}.
      </p>
      <button
        onClick={onDone}
        className="text-xs text-idemora-text-faint hover:text-idemora-text-muted transition-colors"
      >
        Dismiss
      </button>
    </div>
  );
}