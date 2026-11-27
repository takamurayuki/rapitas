/**
 * goal-reflection-api
 *
 * The reflection modal's and settings card's calls to the backend. Not
 * responsible for state or rendering.
 */
import { apiFetch } from '@/lib/api-client';

const fresh = { skipCache: true } as const;

/** One saved reflection (one goal, one week). */
export interface GoalReflectionItem {
  projectId: number;
  weekStart: string;
  rating: number;
  note: string | null;
  updatedAt: string;
}

/** Day (0 = Sunday) and time of the weekly nudge. */
export interface ReflectionPromptSettings {
  dow: number;
  time: string;
}

/** A goal the person is working toward (it has an open milestone). */
export interface ReflectionGoal {
  id: number;
  name: string;
}

export const goalReflectionApi = {
  /** Goals with an open milestone, the ones the nudge asks about. */
  async openGoals(): Promise<ReflectionGoal[]> {
    const goals = await apiFetch<Array<ReflectionGoal & { nextMilestone: unknown | null }>>(
      '/goals',
      fresh,
    );
    return goals.filter((g) => g.nextMilestone !== null).map((g) => ({ id: g.id, name: g.name }));
  },
  list: (goalId: number) => apiFetch<GoalReflectionItem[]>(`/goals/${goalId}/reflections`, fresh),
  save: (goalId: number, rating: number, note: string) =>
    apiFetch<GoalReflectionItem>(`/goals/${goalId}/reflections`, {
      method: 'PUT',
      skipCache: true,
      body: JSON.stringify({ rating, note }),
    }),
  getSettings: () => apiFetch<ReflectionPromptSettings>('/goal-reflections/settings', fresh),
  saveSettings: (settings: ReflectionPromptSettings) =>
    apiFetch<ReflectionPromptSettings>('/goal-reflections/settings', {
      method: 'PUT',
      skipCache: true,
      body: JSON.stringify(settings),
    }),
};
