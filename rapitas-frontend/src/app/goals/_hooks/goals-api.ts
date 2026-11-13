/**
 * goals-api
 *
 * The goal screens' calls to the backend, plus turning an API failure into
 * the message the backend wrote for the person. Not responsible for state.
 */
import { apiFetch } from '@/lib/api-client';
import type {
  GoalDetail,
  GoalSummary,
  Milestone,
  MilestoneStatus,
  UnassignedTask,
} from './goals.types';

const fresh = { skipCache: true } as const;
const send = (method: string, body?: unknown) => ({
  method,
  skipCache: true,
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

/**
 * Pull the backend's own message out of an apiFetch error.
 *
 * apiFetch throws `API Error: <status> (<label>) - <body>`; for this API the
 * body is `{ error, code }`, and `error` is written for the person.
 *
 * @param err - What apiFetch threw / apiFetch が投げた値
 * @returns The backend's message, or null when there is none / バックエンドのメッセージ
 */
export function apiErrorMessage(err: unknown): string | null {
  if (!(err instanceof Error)) return null;
  const match = err.message.match(/ - (\{[\s\S]*\})/);
  if (!match) return null;
  try {
    const body = JSON.parse(match[1]) as { error?: unknown };
    return typeof body.error === 'string' && body.error ? body.error : null;
  } catch {
    return null;
  }
}

export const goalsApi = {
  list: () => apiFetch<GoalSummary[]>('/goals', fresh),
  detail: (id: number) => apiFetch<GoalDetail>(`/goals/${id}`, fresh),
  createGoal: (name: string, description: string) =>
    apiFetch<{ id: number }>(
      '/projects',
      send('POST', { name, description: description || undefined }),
    ),
  updateGoal: (id: number, patch: { name?: string; description?: string }) =>
    apiFetch(`/projects/${id}`, send('PATCH', patch)),
  unassignedTasks: async (goalId: number) => {
    const tasks = await apiFetch<
      Array<UnassignedTask & { milestoneId: number | null; parentId: number | null }>
    >(`/tasks?projectId=${goalId}`, fresh);
    return tasks.filter((t) => t.milestoneId === null && t.parentId === null);
  },
  fileTask: (taskId: number, milestoneId: number) =>
    apiFetch(`/tasks/${taskId}`, send('PATCH', { milestoneId })),
  createMilestone: (projectId: number, name: string, dueDate: string | null) =>
    apiFetch<Milestone>(
      '/milestones',
      send('POST', { projectId, name, ...(dueDate ? { dueDate } : {}) }),
    ),
  updateMilestone: (
    id: number,
    patch: {
      name?: string;
      dueDate?: string | null;
      acceptanceCriteria?: string[];
      status?: Exclude<MilestoneStatus, 'reached'>;
    },
  ) => apiFetch<Milestone>(`/milestones/${id}`, send('PATCH', patch)),
  deleteMilestone: (id: number) => apiFetch(`/milestones/${id}`, send('DELETE')),
  confirmMilestone: (id: number, checkedCriteria: string[], evidence: string) =>
    apiFetch<Milestone>(`/milestones/${id}/confirm`, send('POST', { checkedCriteria, evidence })),
  reopenMilestone: (id: number) => apiFetch<Milestone>(`/milestones/${id}/reopen`, send('POST')),
};
