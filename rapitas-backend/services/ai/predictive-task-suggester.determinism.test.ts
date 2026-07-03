/**
 * predictive-task-suggester.determinism.test
 *
 * Locks the task-suggestion ranking guarantee: when open tasks tie on the
 * computed relevance score, the ranked suggestion list is ordered
 * deterministically by taskId (so the same slice surfaces across runs).
 */
import { describe, it, expect, mock, beforeEach } from 'bun:test';

const mockTaskFindMany = mock(() => Promise.resolve([]));
const mockUserBehaviorFindMany = mock(() => Promise.resolve([]));

mock.module('../../config/database', () => ({
  ensureDatabaseConnection: () => Promise.resolve(),
  prisma: {
    task: { findMany: mockTaskFindMany },
    userBehavior: { findMany: mockUserBehaviorFindMany },
  },
}));

const { getSuggestedTasks } = await import('./predictive-task-suggester');

/** Identical open task (only id differs) → identical score for every task. */
const task = (id: number) => ({
  id,
  title: `task ${id}`,
  priority: 'medium',
  dueDate: null,
  themeId: null,
  estimatedHours: null,
  status: 'todo',
  updatedAt: new Date('2026-01-01'),
  theme: null,
  taskLabels: [],
  pomodoroSessions: [],
});

describe('getSuggestedTasks — stable order on equal score', () => {
  beforeEach(() => {
    mockTaskFindMany.mockReset();
    mockUserBehaviorFindMany.mockReset();
    // No behavior history → neutral productivity pattern → identical task scores.
    mockUserBehaviorFindMany.mockResolvedValue([]);
  });

  it('breaks score ties by taskId ascending', async () => {
    mockTaskFindMany.mockResolvedValue([5, 2, 8, 1, 3].map(task));

    const { suggestions } = await getSuggestedTasks(10);

    expect(suggestions.map((s) => s.taskId)).toEqual([1, 2, 3, 5, 8]);
  });
});
