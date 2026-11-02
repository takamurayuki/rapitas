/**
 * useDueTodayTasks.test
 *
 * Today's due tasks, and — since 2026-10-31 — how many are already past due.
 *
 * The overdue count exists so the widget can say something useful on a day
 * with nothing due: "本日期限のタスクはありません・期限切れ 2件". It splits at
 * the start of today, so a task due earlier today is due today rather than
 * overdue, and the two counts can never describe the same task.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

interface StoreTask {
  id: number;
  title: string;
  status: string;
  dueDate: string | null;
}

const state = { tasks: [] as StoreTask[], initialized: true };

vi.mock('@/stores/task-cache-store', () => ({
  useTaskCacheStore: (selector: (s: typeof state) => unknown) => selector(state),
}));

const { useDueTodayTasks } = await import('../useDueTodayTasks');

/** A local-time date offset from today by whole days, at 12:00. */
const dayOffset = (days: number) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(12, 0, 0, 0);
  return d.toISOString();
};

const task = (id: number, dueDate: string | null, status = 'todo'): StoreTask => ({
  id,
  title: `t${id}`,
  status,
  dueDate,
});

beforeEach(() => {
  state.tasks = [];
  state.initialized = true;
});

describe('what is due today', () => {
  it('counts only today, not yesterday or tomorrow', () => {
    state.tasks = [task(1, dayOffset(0)), task(2, dayOffset(-1)), task(3, dayOffset(1))];
    const { result } = renderHook(() => useDueTodayTasks());
    expect(result.current.totalCount).toBe(1);
    expect(result.current.tasks.map((t) => t.id)).toEqual([1]);
  });

  it('ignores a task with no due date', () => {
    state.tasks = [task(1, null)];
    expect(renderHook(() => useDueTodayTasks()).result.current.totalCount).toBe(0);
  });
});

describe('what is overdue', () => {
  it('counts tasks due before today', () => {
    state.tasks = [task(1, dayOffset(-1)), task(2, dayOffset(-30))];
    expect(renderHook(() => useDueTodayTasks()).result.current.overdueCount).toBe(2);
  });

  // The point of splitting at the start of today: a task due this morning is
  // still today's work, and counting it twice would overstate both numbers.
  it('does not count a task due today, however early', () => {
    const earlier = new Date();
    earlier.setHours(0, 0, 1, 0);
    state.tasks = [task(1, earlier.toISOString())];
    const { result } = renderHook(() => useDueTodayTasks());
    expect(result.current.overdueCount).toBe(0);
    expect(result.current.totalCount).toBe(1);
  });

  it('does not count what is already finished', () => {
    state.tasks = [
      task(1, dayOffset(-1), 'done'),
      task(2, dayOffset(-1), 'cancelled'),
      task(3, dayOffset(-1), 'in-progress'),
    ];
    expect(renderHook(() => useDueTodayTasks()).result.current.overdueCount).toBe(1);
  });

  it('is zero when nothing is past due', () => {
    state.tasks = [task(1, dayOffset(0)), task(2, dayOffset(3))];
    expect(renderHook(() => useDueTodayTasks()).result.current.overdueCount).toBe(0);
  });
});
