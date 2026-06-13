// src/features/goals/components/GoalCreationForm.tsx

import { useState, useEffect } from "react";
import type { Goal, GoalInput, MilestoneInput } from "@/features/goals/db/goalQueries";

interface GoalCreationFormProps {
  goal?:         Goal;              // present when editing
  categories:    string[];          // for autocomplete
  onSubmit:      (input: GoalInput, milestones: Omit<MilestoneInput, "goal_id">[]) => Promise<void>;
  onClose:       () => void;
}

function todayISO(): string {
  return new Date().toISOString().split("T")[0];
}

interface MilestoneRow {
  key:   number;
  title: string;
  date:  string;
}

export function GoalCreationForm({
  goal,
  categories,
  onSubmit,
  onClose,
}: GoalCreationFormProps) {
  const isEditing = !!goal;

  // ── Form state ────────────────────────────────────────────────────────────
  const [title,       setTitle]       = useState(goal?.title       ?? "");
  const [description, setDescription] = useState(goal?.description ?? "");
  const [startDate,   setStartDate]   = useState(goal?.start_date  ?? todayISO());
  const [targetDate,  setTargetDate]  = useState(goal?.target_date ?? "");
  const [category,    setCategory]    = useState(goal?.category    ?? "");
  const [milestones,  setMilestones]  = useState<MilestoneRow[]>([]);
  const [showCatSuggestions, setShowCatSuggestions] = useState(false);
  const [saving,      setSaving]      = useState(false);
  const [errors,      setErrors]      = useState<Record<string, string>>({});

  // Milestone key counter
  const [milestoneKey, setMilestoneKey] = useState(0);

  // Filter category suggestions
  const catSuggestions = categories.filter(
    (c) => c.toLowerCase().includes(category.toLowerCase()) && c !== category
  );

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // ── Milestone helpers ─────────────────────────────────────────────────────

  function addMilestoneRow() {
    setMilestones((prev) => [...prev, { key: milestoneKey, title: "", date: "" }]);
    setMilestoneKey((k) => k + 1);
  }

  function updateMilestoneRow(key: number, field: "title" | "date", value: string) {
    setMilestones((prev) =>
      prev.map((m) => m.key === key ? { ...m, [field]: value } : m)
    );
  }

  function removeMilestoneRow(key: number) {
    setMilestones((prev) => prev.filter((m) => m.key !== key));
  }

  // ── Validation ────────────────────────────────────────────────────────────

  function validate(): boolean {
    const errs: Record<string, string> = {};
    if (!title.trim())   errs.title      = "Title is required";
    if (!targetDate)     errs.targetDate = "Target date is required";
    if (targetDate && startDate && targetDate < startDate)
      errs.targetDate = "Target date must be after start date";

    for (const m of milestones) {
      if (m.title.trim() && !m.date)
        errs[`milestone_${m.key}`] = "Date required";
      if (!m.title.trim() && m.date)
        errs[`milestone_${m.key}`] = "Title required";
    }

    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  // ── Submit ────────────────────────────────────────────────────────────────

  async function handleSubmit() {
    if (!validate()) return;
    setSaving(true);
    try {
      const input: GoalInput = {
        title:       title.trim(),
        description: description.trim() || null,
        start_date:  startDate,
        target_date: targetDate,
        category:    category.trim() || null,
      };

      const validMilestones = milestones
        .filter((m) => m.title.trim() && m.date)
        .map((m) => ({ title: m.title.trim(), date: m.date }));

      await onSubmit(input, validMilestones);
      onClose();
    } finally {
      setSaving(false);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-[60] bg-black/40"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="fixed top-0 right-0 bottom-0 z-[61] w-[480px] max-w-full
                      flex flex-col bg-idemora-bg-primary border-l border-idemora-border
                      shadow-2xl overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4
                        border-b border-idemora-border shrink-0">
          <h2 className="text-sm font-semibold text-idemora-text-normal">
            {isEditing ? "Edit goal" : "New goal"}
          </h2>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded
                       text-idemora-text-muted hover:text-idemora-text-normal
                       hover:bg-idemora-bg-secondary transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M2.5 2.5l9 9M11.5 2.5l-9 9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">

          {/* Title */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-idemora-text-muted">
              Title <span className="text-red-400">*</span>
            </label>
            <input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Goal title"
              className={`w-full text-sm bg-idemora-bg-secondary border rounded px-3 py-2
                         text-idemora-text-normal placeholder:text-idemora-text-faint
                         focus:outline-none focus:border-blue-500 transition-colors
                         ${errors.title ? "border-red-500" : "border-idemora-border"}`}
            />
            {errors.title && (
              <p className="text-xs text-red-400">{errors.title}</p>
            )}
          </div>

          {/* Description */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-idemora-text-muted">
              Description
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional description"
              rows={3}
              className="w-full text-sm bg-idemora-bg-secondary border border-idemora-border
                         rounded px-3 py-2 text-idemora-text-normal resize-none
                         placeholder:text-idemora-text-faint
                         focus:outline-none focus:border-blue-500 transition-colors"
            />
          </div>

          {/* Dates */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-idemora-text-muted">
                Start date
              </label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full text-sm bg-idemora-bg-secondary border border-idemora-border
                           rounded px-3 py-2 text-idemora-text-normal
                           focus:outline-none focus:border-blue-500 transition-colors"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-idemora-text-muted">
                Target date <span className="text-red-400">*</span>
              </label>
              <input
                type="date"
                value={targetDate}
                onChange={(e) => setTargetDate(e.target.value)}
                className={`w-full text-sm bg-idemora-bg-secondary border rounded px-3 py-2
                           text-idemora-text-normal
                           focus:outline-none focus:border-blue-500 transition-colors
                           ${errors.targetDate ? "border-red-500" : "border-idemora-border"}`}
              />
              {errors.targetDate && (
                <p className="text-xs text-red-400">{errors.targetDate}</p>
              )}
            </div>
          </div>

          {/* Category */}
          <div className="space-y-1 relative">
            <label className="text-xs font-medium text-idemora-text-muted">
              Category
            </label>
            <input
              value={category}
              onChange={(e) => { setCategory(e.target.value); setShowCatSuggestions(true); }}
              onFocus={() => setShowCatSuggestions(true)}
              onBlur={() => setTimeout(() => setShowCatSuggestions(false), 150)}
              placeholder="e.g. Health, Career, Learning"
              className="w-full text-sm bg-idemora-bg-secondary border border-idemora-border
                         rounded px-3 py-2 text-idemora-text-normal
                         placeholder:text-idemora-text-faint
                         focus:outline-none focus:border-blue-500 transition-colors"
            />
            {showCatSuggestions && catSuggestions.length > 0 && (
              <div className="absolute left-0 right-0 z-10 mt-1 rounded-lg border
                              border-idemora-border bg-idemora-bg-primary shadow-lg overflow-y-auto max-h-40">
                {catSuggestions.slice(0, 6).map((c) => (
                  <button
                    key={c}
                    onMouseDown={() => { setCategory(c); setShowCatSuggestions(false); }}
                    className="w-full text-left px-3 py-2 text-sm text-idemora-text-normal
                               hover:bg-idemora-bg-secondary transition-colors"
                  >
                    {c}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Milestones */}
          <div className="space-y-2">
            <label className="text-xs font-medium text-idemora-text-muted">
              Milestones
            </label>

            {milestones.map((m) => (
              <div key={m.key} className="flex items-center gap-2">
                <input
                  value={m.title}
                  onChange={(e) => updateMilestoneRow(m.key, "title", e.target.value)}
                  placeholder="Milestone title"
                  className={`flex-1 text-xs bg-idemora-bg-secondary border rounded px-2 py-1.5
                             text-idemora-text-normal placeholder:text-idemora-text-faint
                             focus:outline-none focus:border-blue-500 transition-colors
                             ${errors[`milestone_${m.key}`] ? "border-red-500" : "border-idemora-border"}`}
                />
                <input
                  type="date"
                  value={m.date}
                  onChange={(e) => updateMilestoneRow(m.key, "date", e.target.value)}
                  className={`text-xs bg-idemora-bg-secondary border rounded px-2 py-1.5
                             text-idemora-text-normal
                             focus:outline-none focus:border-blue-500 transition-colors
                             ${errors[`milestone_${m.key}`] ? "border-red-500" : "border-idemora-border"}`}
                />
                <button
                  onClick={() => removeMilestoneRow(m.key)}
                  className="w-6 h-6 flex items-center justify-center rounded
                             text-idemora-text-muted hover:text-red-400
                             hover:bg-idemora-bg-secondary transition-colors shrink-0"
                >
                  <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
                    <path d="M2.5 2.5l9 9M11.5 2.5l-9 9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
                  </svg>
                </button>
              </div>
            ))}

            <button
              onClick={addMilestoneRow}
              className="flex items-center gap-1.5 text-xs text-idemora-text-muted
                         hover:text-idemora-text-normal transition-colors"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M12 5v14M5 12h14"/>
              </svg>
              Add milestone
            </button>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-4
                        border-t border-idemora-border shrink-0">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-idemora-text-muted
                       hover:text-idemora-text-normal transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={saving}
            className="px-4 py-2 text-sm font-medium rounded-lg
                       bg-blue-600 hover:bg-blue-700 text-white
                       disabled:opacity-50 transition-colors"
          >
            {saving ? "Saving…" : isEditing ? "Save changes" : "Create goal"}
          </button>
        </div>
      </div>
    </>
  );
}