// src/features/goals/components/MilestoneList.tsx

import { useState } from "react";
import type { GoalMilestone, MilestoneInput } from "@/features/goals/db/goalQueries";

interface MilestoneListProps {
  goalId:     string;
  milestones: GoalMilestone[];
  onAdd:      (input: MilestoneInput) => Promise<string | void>;
  onUpdate:   (id: string, goalId: string, updates: Partial<Omit<MilestoneInput, "goal_id">>) => Promise<void>;
  onDelete:   (id: string, goalId: string) => Promise<void>;
}

const STATE_DOT: Record<string, string> = {
  blue:   "bg-blue-500",
  green:  "bg-green-500",
  yellow: "bg-yellow-500",
  red:    "bg-red-500",
};

export function MilestoneList({
  goalId,
  milestones,
  onAdd,
  onUpdate,
  onDelete,
}: MilestoneListProps) {
  const [addingNew,    setAddingNew]    = useState(false);
  const [newTitle,     setNewTitle]     = useState("");
  const [newDate,      setNewDate]      = useState("");
  const [editingId,    setEditingId]    = useState<string | null>(null);
  const [editTitle,    setEditTitle]    = useState("");
  const [editDate,     setEditDate]     = useState("");
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [saving,       setSaving]       = useState(false);

  // ── Add ───────────────────────────────────────────────────────────────────

  async function handleAdd() {
    if (!newTitle.trim() || !newDate) return;
    setSaving(true);
    try {
      await onAdd({ goal_id: goalId, title: newTitle.trim(), date: newDate });
      setNewTitle("");
      setNewDate("");
      setAddingNew(false);
    } finally {
      setSaving(false);
    }
  }

  // ── Edit ──────────────────────────────────────────────────────────────────

  function startEdit(m: GoalMilestone) {
    setEditingId(m.id);
    setEditTitle(m.title);
    setEditDate(m.date);
  }

  async function handleSaveEdit(id: string) {
    if (!editTitle.trim() || !editDate) return;
    setSaving(true);
    try {
      await onUpdate(id, goalId, { title: editTitle.trim(), date: editDate });
      setEditingId(null);
    } finally {
      setSaving(false);
    }
  }

  // ── Delete ────────────────────────────────────────────────────────────────

  async function handleDelete(id: string) {
    setSaving(true);
    try {
      await onDelete(id, goalId);
      setConfirmingId(null);
    } finally {
      setSaving(false);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-1">

      {/* Milestone rows */}
      {milestones.length === 0 && !addingNew && (
        <p className="text-xs text-idemora-text-faint py-1">
          No milestones yet.
        </p>
      )}

      {milestones.map((m) => (
        <div key={m.id}>
          {editingId === m.id ? (
            // ── Edit row ──
            <div className="flex items-center gap-2 py-1">
              <input
                autoFocus
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSaveEdit(m.id);
                  if (e.key === "Escape") setEditingId(null);
                }}
                placeholder="Milestone title"
                className="flex-1 text-xs bg-idemora-bg-secondary border border-idemora-border
                           rounded px-2 py-1 text-idemora-text-normal
                           focus:outline-none focus:border-blue-500"
              />
              <input
                type="date"
                value={editDate}
                onChange={(e) => setEditDate(e.target.value)}
                className="text-xs bg-idemora-bg-secondary border border-idemora-border
                           rounded px-2 py-1 text-idemora-text-normal
                           focus:outline-none focus:border-blue-500"
              />
              <button
                onClick={() => handleSaveEdit(m.id)}
                disabled={saving || !editTitle.trim() || !editDate}
                className="text-xs px-2 py-1 rounded bg-blue-600 hover:bg-blue-700
                           text-white disabled:opacity-50 transition-colors"
              >
                Save
              </button>
              <button
                onClick={() => setEditingId(null)}
                className="text-xs px-2 py-1 rounded text-idemora-text-muted
                           hover:text-idemora-text-normal transition-colors"
              >
                Cancel
              </button>
            </div>
          ) : confirmingId === m.id ? (
            // ── Delete confirm row ──
            <div className="flex items-center gap-2 py-1">
              <span className="flex-1 text-xs text-idemora-text-muted">
                Delete "{m.title}"?
              </span>
              <button
                onClick={() => handleDelete(m.id)}
                disabled={saving}
                className="text-xs px-2 py-1 rounded bg-red-600 hover:bg-red-700
                           text-white disabled:opacity-50 transition-colors"
              >
                Delete
              </button>
              <button
                onClick={() => setConfirmingId(null)}
                className="text-xs px-2 py-1 rounded text-idemora-text-muted
                           hover:text-idemora-text-normal transition-colors"
              >
                Cancel
              </button>
            </div>
          ) : (
            // ── Normal row ──
            <div className="flex items-center gap-2 py-1 group/row">
              <span className={`shrink-0 w-2 h-2 rounded-full ${STATE_DOT[m.colour_state] ?? STATE_DOT.blue}`} />
              <span className="flex-1 text-xs text-idemora-text-normal truncate">
                {m.title}
              </span>
              <span className="text-xs text-idemora-text-faint shrink-0">
                {new Date(m.date + "T00:00:00").toLocaleDateString("en-GB", {
                  day: "numeric", month: "short", year: "numeric",
                })}
              </span>
              {/* Actions — visible on hover */}
              <div className="flex items-center gap-1 opacity-0 group-hover/row:opacity-100 transition-opacity">
                {/* Mark done — only for non-terminal states */}
                {(m.colour_state === "blue" || m.colour_state === "yellow") && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onUpdate(m.id, goalId, { colour_state: "green" });
                    }}
                    className="w-6 h-6 flex items-center justify-center rounded
                               text-idemora-text-muted hover:text-green-400
                               hover:bg-idemora-bg-secondary transition-colors"
                    title="Mark done"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
                         stroke="currentColor" strokeWidth="2.5">
                      <path d="M20 6L9 17l-5-5"/>
                    </svg>
                  </button>
                )}

                {/* Existing edit button */}
                <button
                  onClick={() => startEdit(m)}
                  className="w-6 h-6 flex items-center justify-center rounded
                             text-idemora-text-muted hover:text-idemora-text-normal
                             hover:bg-idemora-bg-secondary transition-colors"
                  title="Edit milestone"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
                    <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
                  </svg>
                </button>

                {/* Existing delete button */}
                <button
                  onClick={() => setConfirmingId(m.id)}
                  className="w-6 h-6 flex items-center justify-center rounded
                             text-idemora-text-muted hover:text-red-400
                             hover:bg-idemora-bg-secondary transition-colors"
                  title="Delete milestone"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="3 6 5 6 21 6"/>
                    <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/>
                    <path d="M10 11v6M14 11v6"/>
                    <path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/>
                  </svg>
                </button>
              </div>
            </div>
          )}
        </div>
      ))}

      {/* Add new milestone row */}
      {addingNew ? (
        <div className="flex items-center gap-2 py-1">
          <input
            autoFocus
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleAdd();
              if (e.key === "Escape") { setAddingNew(false); setNewTitle(""); setNewDate(""); }
            }}
            placeholder="Milestone title"
            className="flex-1 text-xs bg-idemora-bg-secondary border border-idemora-border
                       rounded px-2 py-1 text-idemora-text-normal
                       focus:outline-none focus:border-blue-500"
          />
          <input
            type="date"
            value={newDate}
            onChange={(e) => setNewDate(e.target.value)}
            className="text-xs bg-idemora-bg-secondary border border-idemora-border
                       rounded px-2 py-1 text-idemora-text-normal
                       focus:outline-none focus:border-blue-500"
          />
          <button
            onClick={handleAdd}
            disabled={saving || !newTitle.trim() || !newDate}
            className="text-xs px-2 py-1 rounded bg-blue-600 hover:bg-blue-700
                       text-white disabled:opacity-50 transition-colors"
          >
            Add
          </button>
          <button
            onClick={() => { setAddingNew(false); setNewTitle(""); setNewDate(""); }}
            className="text-xs px-2 py-1 rounded text-idemora-text-muted
                       hover:text-idemora-text-normal transition-colors"
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          onClick={() => setAddingNew(true)}
          className="flex items-center gap-1.5 text-xs text-idemora-text-muted
                     hover:text-idemora-text-normal transition-colors py-1 w-fit"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M12 5v14M5 12h14"/>
          </svg>
          Add milestone
        </button>
      )}
    </div>
  );
}