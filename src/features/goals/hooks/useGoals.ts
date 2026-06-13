// src/features/goals/hooks/useGoals.ts

import { useState, useCallback } from "react";
import {
  createGoal,
  updateGoal,
  deleteGoal,
  listGoals,
  createMilestone,
  updateMilestone,
  deleteMilestone,
  getMilestonesForGoal,
  getGoalCategories,
  updateGoalColourState,
  updateGoalProgress,
  type Goal,
  type GoalInput,
  type GoalMilestone,
  type MilestoneInput,
  type GoalStatusFilter,
  type GoalColourState,
} from "@/features/goals/db/goalQueries";
import { useGoalStore } from "@/features/goals/store/useGoalStore";

export function useGoals() {
  const [milestones, setMilestones]   = useState<GoalMilestone[]>([]);
  const [categories, setCategories]   = useState<string[]>([]);
  const [loading, setLoading]         = useState(false);

  const goals                  = useGoalStore((s) => s.goals);
  const selectedGoalId         = useGoalStore((s) => s.selectedGoalId);
  const activeFilter           = useGoalStore((s) => s.activeFilter);
  const activeCategoryFilter   = useGoalStore((s) => s.activeCategoryFilter);
  const setGoals               = useGoalStore((s) => s.setGoals);
  const setSelectedGoalId      = useGoalStore((s) => s.setSelectedGoalId);
  const setActiveFilter        = useGoalStore((s) => s.setActiveFilter);
  const setActiveCategoryFilter= useGoalStore((s) => s.setActiveCategoryFilter);

  // ── Load ──────────────────────────────────────────────────────────────────

  const loadGoals = useCallback(async (filter?: GoalStatusFilter | null) => {
    setLoading(true);
    try {
      const loaded = await listGoals(filter ?? activeFilter);
      setGoals(loaded);
    } catch (err) {
      console.error("[useGoals] loadGoals failed:", err);
    } finally {
      setLoading(false);
    }
  }, [activeFilter, setGoals]);

  const loadMilestones = useCallback(async (goalId: string) => {
    try {
      const loaded = await getMilestonesForGoal(goalId);
      setMilestones(loaded);
    } catch (err) {
      console.error("[useGoals] loadMilestones failed:", err);
    }
  }, []);

  const loadCategories = useCallback(async () => {
    try {
      const loaded = await getGoalCategories();
      setCategories(loaded);
    } catch (err) {
      console.error("[useGoals] loadCategories failed:", err);
    }
  }, []);

  // ── Goal mutations ────────────────────────────────────────────────────────

  const handleCreateGoal = useCallback(async (
    input: GoalInput,
    milestoneInputs: Omit<MilestoneInput, "goal_id">[] = []
  ): Promise<string> => {
    const id = await createGoal(input);

    // Create any milestones defined at goal creation time
    for (const m of milestoneInputs) {
      await createMilestone({ ...m, goal_id: id });
    }

    await loadGoals();
    return id;
  }, [loadGoals]);

  const handleUpdateGoal = useCallback(async (
    id: string,
    updates: Partial<GoalInput>
  ): Promise<void> => {
    await updateGoal(id, updates);
    await loadGoals();
  }, [loadGoals]);

  const handleUpdateColourState = useCallback(async (
    id: string,
    state: GoalColourState
  ): Promise<void> => {
    await updateGoalColourState(id, state);
    await loadGoals();
  }, [loadGoals]);

  const handleUpdateProgress = useCallback(async (
    id: string,
    progress: number
  ): Promise<void> => {
    await updateGoalProgress(id, progress);
    await loadGoals();
  }, [loadGoals]);

  const handleDeleteGoal = useCallback(async (id: string): Promise<void> => {
    await deleteGoal(id);
    if (selectedGoalId === id) setSelectedGoalId(null);
    await loadGoals();
  }, [loadGoals, selectedGoalId, setSelectedGoalId]);

  // ── Milestone mutations ───────────────────────────────────────────────────

  const handleCreateMilestone = useCallback(async (
    input: MilestoneInput
  ): Promise<string> => {
    const id = await createMilestone(input);
    await loadMilestones(input.goal_id);
    return id;
  }, [loadMilestones]);

  const handleUpdateMilestone = useCallback(async (
    id: string,
    goalId: string,
    updates: Partial<Omit<MilestoneInput, "goal_id">>
  ): Promise<void> => {
    await updateMilestone(id, updates);
    await loadMilestones(goalId);
  }, [loadMilestones]);

  const handleDeleteMilestone = useCallback(async (
    id: string,
    goalId: string
  ): Promise<void> => {
    await deleteMilestone(id);
    await loadMilestones(goalId);
  }, [loadMilestones]);

  // ── Filter helpers ────────────────────────────────────────────────────────

  const filteredGoals = activeCategoryFilter
    ? goals.filter((g) => g.category === activeCategoryFilter)
    : goals;

  return {
    // State
    goals: filteredGoals,
    allGoals: goals,
    milestones,
    categories,
    loading,
    selectedGoalId,
    activeFilter,
    activeCategoryFilter,

    // Loaders
    loadGoals,
    loadMilestones,
    loadCategories,

    // Goal mutations
    createGoal:          handleCreateGoal,
    updateGoal:          handleUpdateGoal,
    updateColourState:   handleUpdateColourState,
    updateProgress:      handleUpdateProgress,
    deleteGoal:          handleDeleteGoal,

    // Milestone mutations
    createMilestone:     handleCreateMilestone,
    updateMilestone:     handleUpdateMilestone,
    deleteMilestone:     handleDeleteMilestone,

    // Filter setters
    setSelectedGoalId,
    setActiveFilter,
    setActiveCategoryFilter,
  };
}