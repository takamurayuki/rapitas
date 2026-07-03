import { renderHook } from '@testing-library/react';
import { useDueTodayTasks } from '../ui/useDueTodayTasks';
import { useTaskCacheStore } from '@/stores/task-cache-store';
import type { Task } from '@/types';

function makeTask(overrides: Partial<Task>): Task {
  return {
    id: 1,
    title: 'task',
    status: 'todo',
    categoryId: null,
    themeId: null,
    priority: 'medium',
    dueDate: null,
    ...overrides,
  } as Task;
}

describe('useDueTodayTasks', () => {
  const RealDate = Date;

  beforeEach(() => {
    vi.useFakeTimers();
    useTaskCacheStore.setState({ tasks: [], initialized: true });
    // Fix "today" to a known local date/time.
    vi.setSystemTime(new RealDate('2026-06-15T12:00:00'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns empty when there are no tasks', () => {
    const { result } = renderHook(() => useDueTodayTasks());
    expect(result.current.tasks).toEqual([]);
    expect(result.current.totalCount).toBe(0);
    expect(result.current.completedCount).toBe(0);
  });

  it('includes a task due today and excludes one due tomorrow', () => {
    useTaskCacheStore.setState({
      tasks: [
        makeTask({ id: 1, title: 'Today task', dueDate: '2026-06-15T09:00:00.000Z' }),
        makeTask({ id: 2, title: 'Tomorrow task', dueDate: '2026-06-16T09:00:00.000Z' }),
        makeTask({ id: 3, title: 'No due date', dueDate: null }),
      ],
      initialized: true,
    });

    const { result } = renderHook(() => useDueTodayTasks());
    expect(result.current.tasks.map((t) => t.id)).toEqual([1]);
    expect(result.current.totalCount).toBe(1);
  });

  it('counts completed (done) tasks separately from total', () => {
    useTaskCacheStore.setState({
      tasks: [
        makeTask({ id: 1, dueDate: '2026-06-15T01:00:00.000Z', status: 'done' }),
        makeTask({ id: 2, dueDate: '2026-06-15T02:00:00.000Z', status: 'todo' }),
      ],
      initialized: true,
    });

    const { result } = renderHook(() => useDueTodayTasks());
    expect(result.current.totalCount).toBe(2);
    expect(result.current.completedCount).toBe(1);
  });

  it('reflects isLoading from store initialization state', () => {
    useTaskCacheStore.setState({ tasks: [], initialized: false });
    const { result } = renderHook(() => useDueTodayTasks());
    expect(result.current.isLoading).toBe(true);
  });
});
