// src/features/goals/store/useGoalStore.ts

import { create } from "zustand";
import type { Goal, GoalStatusFilter } from "@/features/goals/db/goalQueries";

interface GoalStore {
  goals:                 Goal[];
  selectedGoalId:        string | null;
  activeFilter:          GoalStatusFilter | null;
  activeCategoryFilter:  string | null;

  setGoals:               (goals: Goal[]) => void;
  setSelectedGoalId:      (id: string | null) => void;
  setActiveFilter:        (filter: GoalStatusFilter | null) => void;
  setActiveCategoryFilter:(category: string | null) => void;
}

export const useGoalStore = create<GoalStore>((set) => ({
  goals:                  [],
  selectedGoalId:         null,
  activeFilter:           null,
  activeCategoryFilter:   null,

  setGoals:               (goals) => set({ goals }),
  setSelectedGoalId:      (id) => set({ selectedGoalId: id }),
  setActiveFilter:        (filter) => set({ activeFilter: filter }),
  setActiveCategoryFilter:(category) => set({ activeCategoryFilter: category }),
}));