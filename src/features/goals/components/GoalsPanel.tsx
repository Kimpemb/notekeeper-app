// src/features/goals/components/GoalsPanel.tsx

import { useEffect, useState } from "react";
import type { Goal, GoalInput, GoalStatusFilter, MilestoneInput } from "@/features/goals/db/goalQueries";
import { useGoals } from "@/features/goals/hooks/useGoals";
import { useGoalStore } from "@/features/goals/store/useGoalStore";
import { GoalCard } from "./GoalCard";
import { GoalDetail } from "./GoalDetail";
import { GoalCreationForm } from "./GoalCreationForm";
import { ConfirmModal } from "@/features/ui/components/ConfirmModal";
import { GoalBootstrap } from "./GoalBootstrap";

const STATUS_TABS: { filter: GoalStatusFilter; label: string }[] = [
  { filter: "active",     label: "Active"     },
  { filter: "unresolved", label: "Unresolved" },
  { filter: "upcoming",   label: "Upcoming"   },
  { filter: "completed",  label: "Completed"  },
  { filter: "missed",     label: "Missed"     },
];

const TAB_BADGE_STYLES: Record<GoalStatusFilter, string> = {
  active:     "bg-blue-500/10 text-blue-400",
  unresolved: "bg-yellow-500/10 text-yellow-400",
  upcoming:   "bg-idemora-bg-secondary text-idemora-text-muted",
  completed:  "bg-green-500/10 text-green-400",
  missed:     "bg-red-500/10 text-red-400",
};

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
    setSelectedGoalId,
    setActiveCategoryFilter,
  } = useGoals();

  // Tab selection lives in useGoalStore — already had this field, just unused until now
  const activeFilter    = useGoalStore((s) => s.activeFilter);
  const setActiveFilter = useGoalStore((s) => s.setActiveFilter);
  const selectedTab: GoalStatusFilter = activeFilter ?? "active";

  const [showCreateForm,  setShowCreateForm]  = useState(false);
  const [editingGoal,     setEditingGoal]     = useState<Goal | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [showBootstrap,   setShowBootstrap]   = useState(false);

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

  // Reload when frontmatter parser creates/updates a goal in the background
  useEffect(() => {
    function handleGoalsUpdated() {
      console.log("[GoalsPanel] received idemora:goals-updated");
      loadGoals(null);
    }
    window.addEventListener("idemora:goals-updated", handleGoalsUpdated);
    return () => window.removeEventListener("idemora:goals-updated", handleGoalsUpdated);
  }, [loadGoals]);

  const selectedGoal = goals.find((g) => g.id === selectedGoalId) ?? null;

  // ── Status filter helper ──────────────────────────────────────────────────
  // Same mapping as before, just queried per-tab instead of per-section

function goalsForFilter(filter: GoalStatusFilter): Goal[] {
  const today = new Date().toISOString().split("T")[0];

  let results: Goal[];
  switch (filter) {
    case "active":
      results = goals.filter((g) => g.colour_state === "blue" && g.target_date >= today);
      break;
    case "upcoming":
      results = goals.filter((g) => g.start_date > today);
      break;
    case "unresolved":
      results = goals.filter((g) => g.colour_state === "yellow");
      break;
    case "completed":
      results = goals.filter((g) => g.colour_state === "green");
      break;
    case "missed":
      results = goals.filter((g) => g.colour_state === "red");
      break;
    default:
      results = [];
  }

  if (activeCategoryFilter) {
    results = results.filter((g) => g.category === activeCategoryFilter);
  }

  return results;
}

  const tabCounts = STATUS_TABS.reduce((acc, { filter }) => {
    acc[filter] = goalsForFilter(filter).length;
    return acc;
  }, {} as Record<GoalStatusFilter, number>);

  const currentGoals = goalsForFilter(selectedTab);

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

      {/* ── Tabs + list ── */}
      <div className="flex-1 overflow-y-auto px-4 py-3">

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

        {!loading && goals.length > 0 && (
          <>
            {/* Status tabs */}
            <div className="flex items-center gap-1 mb-3 border-b border-idemora-border overflow-x-auto">
              {STATUS_TABS.map(({ filter, label }) => {
                const count    = tabCounts[filter];
                const isActive = selectedTab === filter;
                return (
                  <button
                    key={filter}
                    onClick={() => setActiveFilter(filter)}
                    className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium
                               border-b-2 whitespace-nowrap transition-colors
                               ${isActive
                                 ? "border-blue-500 text-idemora-text-normal"
                                 : "border-transparent text-idemora-text-muted hover:text-idemora-text-normal"}`}
                  >
                    {label}
                    {count > 0 && (
                      <span className={`text-[11px] leading-none px-1.5 py-0.5 rounded-full font-medium ${TAB_BADGE_STYLES[filter]}`}>
                        {count}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Goal list for the selected tab */}
            {currentGoals.length === 0 ? (
              <p className="text-xs text-idemora-text-faint text-center py-8">
                No {STATUS_TABS.find((t) => t.filter === selectedTab)?.label.toLowerCase()} goals
              </p>
            ) : (
              <div className="space-y-1.5">
                {currentGoals.map((goal) => (
                  <GoalCard
                    key={goal.id}
                    goal={goal}
                    onClick={(g) => setSelectedGoalId(g.id)}
                  />
                ))}
              </div>
            )}
          </>
        )}

        {/* Bootstrap from notes */}
        {!loading && (
          <div className="mt-4 pt-4 border-t border-idemora-border">
            {showBootstrap ? (
              <GoalBootstrap onDone={() => { setShowBootstrap(false); loadGoals(null); }} />
            ) : (
              <button
                onClick={() => setShowBootstrap(true)}
                className="text-xs text-idemora-text-muted hover:text-idemora-text-normal transition-colors"
              >
                Bootstrap goals from notes
              </button>
            )}
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