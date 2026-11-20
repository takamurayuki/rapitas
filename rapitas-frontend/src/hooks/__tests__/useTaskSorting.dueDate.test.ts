/**
 * useTaskSorting dueDate sort tests
 *
 * Covers sorting by due date: ascending/descending order and tasks without a due date.
 */
import { renderHook } from '@testing-library/react';
import { useTaskSorting } from '../task/useTaskSorting';
import type { Task } from '@/types';

const make = (id: number, dueDate?: string | null): Task =>
  ({
    id,
    title: `T${id}`,
    status: 'todo',
    priority: 'medium',
    labels: [],
    createdAt: new Date('2025-01-01').toISOString(),
    updatedAt: new Date('2025-01-01').toISOString(),
    dueDate,
  }) as Task;

const tasks = [
  make(1, '2025-03-01T00:00:00.000Z'),
  make(2, null),
  make(3, '2025-01-15T00:00:00.000Z'),
  make(4),
  make(5, '2025-02-01T00:00:00.000Z'),
];

describe('useTaskSorting dueDate', () => {
  it('sorts nearest due date first in asc, tasks without a due date last', () => {
    const { result } = renderHook(() =>
      useTaskSorting({ tasks, sortBy: 'dueDate', sortOrder: 'asc' }),
    );
    expect(result.current.map((t) => t.id)).toEqual([3, 5, 1, 2, 4]);
  });

  it('sorts farthest due date first in desc, tasks without a due date still last', () => {
    const { result } = renderHook(() =>
      useTaskSorting({ tasks, sortBy: 'dueDate', sortOrder: 'desc' }),
    );
    expect(result.current.map((t) => t.id)).toEqual([1, 5, 3, 2, 4]);
  });
});
