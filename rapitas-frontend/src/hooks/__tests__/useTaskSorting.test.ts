import { renderHook } from '@testing-library/react';
import { useTaskSorting } from '../task/useTaskSorting';
import type { Task } from '@/types';

const createMockTask = (overrides: Partial<Task> = {}): Task =>
  ({
    id: 1,
    title: 'Test Task',
    status: 'todo',
    priority: 'medium',
    labels: '[]',
    createdAt: new Date('2025-01-01').toISOString(),
    updatedAt: new Date('2025-01-01').toISOString(),
    ...overrides,
  }) as Task;

describe('useTaskSorting', () => {
  const tasks = [
    createMockTask({
      id: 1,
      title: 'Beta',
      priority: 'low',
      createdAt: new Date('2025-01-03').toISOString(),
    }),
    createMockTask({
      id: 2,
      title: 'Alpha',
      priority: 'high',
      createdAt: new Date('2025-01-01').toISOString(),
    }),
    createMockTask({
      id: 3,
      title: 'Gamma',
      priority: 'urgent',
      createdAt: new Date('2025-01-02').toISOString(),
    }),
  ];

  it('should sort by title ascending', () => {
    const { result } = renderHook(() =>
      useTaskSorting({ tasks, sortBy: 'title', sortOrder: 'asc' }),
    );
    expect(result.current.map((t) => t.title)).toEqual(['Alpha', 'Beta', 'Gamma']);
  });

  it('should sort by title descending', () => {
    const { result } = renderHook(() =>
      useTaskSorting({ tasks, sortBy: 'title', sortOrder: 'desc' }),
    );
    expect(result.current.map((t) => t.title)).toEqual(['Gamma', 'Beta', 'Alpha']);
  });

  it('should sort by priority ascending', () => {
    const { result } = renderHook(() =>
      useTaskSorting({ tasks, sortBy: 'priority', sortOrder: 'asc' }),
    );
    expect(result.current.map((t) => t.priority)).toEqual(['low', 'high', 'urgent']);
  });

  it('should sort by priority descending', () => {
    const { result } = renderHook(() =>
      useTaskSorting({ tasks, sortBy: 'priority', sortOrder: 'desc' }),
    );
    expect(result.current.map((t) => t.priority)).toEqual(['urgent', 'high', 'low']);
  });

  it('should sort by createdAt ascending', () => {
    const { result } = renderHook(() =>
      useTaskSorting({ tasks, sortBy: 'createdAt', sortOrder: 'asc' }),
    );
    expect(result.current.map((t) => t.id)).toEqual([2, 3, 1]);
  });

  it('should sort by createdAt descending', () => {
    const { result } = renderHook(() =>
      useTaskSorting({ tasks, sortBy: 'createdAt', sortOrder: 'desc' }),
    );
    expect(result.current.map((t) => t.id)).toEqual([1, 3, 2]);
  });

  it('should not mutate the original array', () => {
    const original = [...tasks];
    renderHook(() => useTaskSorting({ tasks, sortBy: 'title', sortOrder: 'asc' }));
    expect(tasks).toEqual(original);
  });

  it('should return empty array for empty input', () => {
    const { result } = renderHook(() =>
      useTaskSorting({ tasks: [], sortBy: 'title', sortOrder: 'asc' }),
    );
    expect(result.current).toEqual([]);
  });

  it('should memoize result when inputs unchanged', () => {
    const { result, rerender } = renderHook((props) => useTaskSorting(props), {
      initialProps: {
        tasks,
        sortBy: 'title' as const,
        sortOrder: 'asc' as const,
      },
    });
    const first = result.current;
    rerender({ tasks, sortBy: 'title' as const, sortOrder: 'asc' as const });
    expect(result.current).toBe(first);
  });
});
