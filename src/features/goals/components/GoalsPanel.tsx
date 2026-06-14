// src/features/goals/components/GoalsPanel.tsx

import { useEffect, useState } from "react";
import type { Goal, GoalInput, GoalStatusFilter, MilestoneInput } from "@/features/goals/db/goalQueries";
import { useGoals } from "@/features/goals/hooks/useGoals";
import { GoalCard } from "./GoalCard";
import { GoalDetail } from "./GoalDetail";
import { GoalCreationForm } from "./GoalCreationForm";
import { ConfirmModal } from "@/features/ui/components/ConfirmModal";

const SECTIONS: { filter: GoalStatusFilter; label: string }[] = [
  { filter: "active",     label: "Active"      },
  { filter: "upcoming",   label: "Upcoming"    },
  { filter: "unresolved", label: "Unresolved"  },
  { filter: "completed",  label: "Completed"   },
  { filter: "missed",     label: "Missed"      },
];

export function GoalsPanel() {
  const {
    goals,
    milestones,
    categories,
    loading,
    selectedGoalId,
    activeCategoryFilter,
    loadGoals,
    loadMilestones,
    loadCategories,
    createGoal,
    updateGoal,
    deleteGoal,
    createMilestone,
    updateMilestone,
    deleteMilestone,
    updateProgress,
    setSelectedGoalId,
    setActiveCategoryFilter,
  } = useGoals();

  const [showCreateForm,  setShowCreateForm]  = useState(false);
  const [editingGoal,     setEditingGoal]     = useState<Goal | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [collapsed,       setCollapsed]       = useState<Set<GoalStatusFilter>>(new Set());

  // Load all goals and categories on mount
  useEffect(() => {
    loadGoals(null);
    loadCategories();
  }, []);

  // Load milestones when selectedGoalId is set — covers both normal card
  // clicks and external navigation (e.g. from calendar banner click)
  useEffect(() => {
    if (selectedGoalId) loadMilestones(selectedGoalId);
  }, [selectedGoalId, loadMilestones]);

  // If goals weren't loaded yet when selectedGoalId was set externally,
  // re-trigger milestone load once goals arrive
  useEffect(() => {
    if (selectedGoalId && goals.length > 0) {
      loadMilestones(selectedGoalId);
    }
  }, [goals.length, selectedGoalId, loadMilestones]);

  const selectedGoal = goals.find((g) => g.id === selectedGoalId) ?? null;

  // ── Section helpers ───────────────────────────────────────────────────────

  function toggleSection(filter: GoalStatusFilter) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.has(filter) ? next.delete(filter) : next.add(filter);
      return next;
    });
  }

  function goalsForSection(filter: GoalStatusFilter): Goal[] {
    const today = new Date().toISOString().split("T")[0];
    switch (filter) {
      case "active":
        return goals.filter((g) => g.colour_state === "blue" && g.target_date >= today);
      case "upcoming":
        return goals.filter((g) => g.start_date > today);
      case "unresolved":
        return goals.filter((g) => g.colour_state === "yellow");
      case "completed":
        return goals.filter((g) => g.colour_state === "green");
      case "missed":
        return goals.filter((g) => g.colour_state === "red");
    }
  }

  // ── Handlers ──────────────────────────────────────────────────────────────

  async function handleSubmitCreate(
    input: GoalInput,
    milestoneInputs: Omit<MilestoneInput, "goal_id">[]
  ) {
    await createGoal(input, milestoneInputs);
    loadCategories();
    setShowCreateForm(false);
  }

  async function handleSubmitEdit(
    input: GoalInput,
    _milestoneInputs: Omit<MilestoneInput, "goal_id">[]
  ) {
    if (!editingGoal) return;
    await updateGoal(editingGoal.id, input);
    loadCategories();
    setEditingGoal(null);
    if (selectedGoalId === editingGoal.id) loadMilestones(editingGoal.id);
  }

  async function handleDelete(id: string) {
    await deleteGoal(id);
    setConfirmDeleteId(null);
    setSelectedGoalId(null);
  }

  function handleEditFromDetail(goal: Goal) {
    setSelectedGoalId(null);
    setEditingGoal(goal);
  }

  // ── Unique categories for filter ──────────────────────────────────────────
  const allCategories = Array.from(
    new Set(goals.map((g) => g.category).filter(Boolean) as string[])
  ).sort();

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full bg-idemora-bg-primary overflow-hidden">

      {/* ── Top bar ── */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-idemora-border shrink-0">

        {/* Category filter */}
        {allCategories.length > 0 && (
          <select
            value={activeCategoryFilter ?? ""}
            onChange={(e) => setActiveCategoryFilter(e.target.value || null)}
            className="text-xs bg-idemora-bg-secondary border border-idemora-border
                       rounded px-2 py-1.5 text-idemora-text-normal
                       focus:outline-none focus:border-blue-500 transition-colors"
          >
            <option value="">All categories</option>
            {allCategories.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        )}

        <span className="flex-1" />

        {/* Create button */}
        <button
          onClick={() => setShowCreateForm(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium
                     bg-blue-600 hover:bg-blue-700 text-white transition-colors"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M12 5v14M5 12h14"/>
          </svg>
          New goal
        </button>
      </div>

      {/* ── Sections ── */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">

        {loading && (
          <p className="text-xs text-idemora-text-faint text-center py-8">
            Loading goals…
          </p>
        )}

        {!loading && goals.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" strokeWidth="1.2"
                 className="text-idemora-text-faint">
              <circle cx="12" cy="12" r="10"/>
              <circle cx="12" cy="12" r="6"/>
              <circle cx="12" cy="12" r="2"/>
            </svg>
            <p className="text-sm text-idemora-text-muted">No goals yet</p>
            <button
              onClick={() => setShowCreateForm(true)}
              className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
            >
              Create your first goal
            </button>
          </div>
        )}

        {!loading && SECTIONS.map(({ filter, label }) => {
          const sectionGoals = goalsForSection(filter);
          if (sectionGoals.length === 0) return null;

          const isCollapsed = collapsed.has(filter);

          return (
            <div key={filter}>
              {/* Section header */}
              <button
                onClick={() => toggleSection(filter)}
                className="flex items-center gap-2 w-full mb-2 group"
              >
                <svg
                  width="12" height="12" viewBox="0 0 12 12" fill="none"
                  className={`text-idemora-text-faint transition-transform duration-150
                             ${isCollapsed ? "-rotate-90" : ""}`}
                >
                  <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                <span className="text-xs font-semibold text-idemora-text-muted uppercase tracking-wide">
                  {label}
                </span>
                <span className="text-xs text-idemora-text-faint">
                  {sectionGoals.length}
                </span>
              </button>

              {/* Goal cards */}
              {!isCollapsed && (
                <div className="space-y-1.5">
                  {sectionGoals.map((goal) => (
                    <GoalCard
                      key={goal.id}
                      goal={goal}
                      onClick={(g) => setSelectedGoalId(g.id)}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}

        {/* Bootstrap from notes — stub for Phase 13 */}
        {!loading && (
          <div className="pt-4 border-t border-idemora-border">
            <button
              disabled
              className="text-xs text-idemora-text-faint cursor-not-allowed"
              title="Available in Phase 13"
            >
              Bootstrap goals from notes — coming in Phase 13
            </button>
          </div>
        )}
      </div>

      {/* ── Modals ── */}

      {showCreateForm && (
        <GoalCreationForm
          categories={categories}
          onSubmit={handleSubmitCreate}
          onClose={() => setShowCreateForm(false)}
        />
      )}

      {editingGoal && (
        <GoalCreationForm
          goal={editingGoal}
          categories={categories}
          onSubmit={handleSubmitEdit}
          onClose={() => setEditingGoal(null)}
        />
      )}

      {selectedGoal && !editingGoal && (
        <GoalDetail
          goal={selectedGoal}
          milestones={milestones}
          onEdit={handleEditFromDetail}
          onDelete={(id) => setConfirmDeleteId(id)}
          onClose={() => setSelectedGoalId(null)}
          onAddMilestone={createMilestone}
          onUpdateMilestone={updateMilestone}
          onDeleteMilestone={deleteMilestone}
          onUpdateProgress={updateProgress}
        />
      )}

      {confirmDeleteId && (
        <ConfirmModal
          open
          danger
          title="Delete goal?"
          message="This will permanently delete the goal and all its milestones. This cannot be undone."
          confirmLabel="Delete goal"
          onConfirm={() => handleDelete(confirmDeleteId)}
          onCancel={() => setConfirmDeleteId(null)}
        />
      )}
    </div>
  );
}