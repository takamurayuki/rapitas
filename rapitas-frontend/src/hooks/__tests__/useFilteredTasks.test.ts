import { renderHook } from '@testing-library/react';
import { useFilteredTasks } from '../useFilteredTasks';
import type { Task, Theme } from '@/types';

const createTask = (overrides: Partial<Task> = {}): Task =>
  ({
    id: 1,
    title: 'Test Task',
    status: 'todo',
    priority: 'medium',
    labels: '[]',
    themeId: null,
    parentId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  }) as Task;

const themes: Theme[] = [
  { id: 1, name: 'Frontend', categoryId: 1 } as Theme,
  { id: 2, name: 'Backend', categoryId: 1 } as Theme,
  { id: 3, name: 'Design', categoryId: 2 } as Theme,
];

const defaultProps = {
  filter: 'all',
  categoryFilter: null,
  themeFilter: null,
  priorityFilter: null,
  searchQuery: '',
  themes,
};

describe('useFilteredTasks', () => {
  it('should return all tasks with no filters', () => {
    const tasks = [
      createTask({ id: 1, status: 'todo' }),
      createTask({ id: 2, status: 'in-progress' }),
      createTask({ id: 3, status: 'done' }),
    ];

    const { result } = renderHook(() =>
      useFilteredTasks({ ...defaultProps, tasks }),
    );

    expect(result.current.filteredTasks).toHaveLength(3);
    expect(result.current.statusCounts).toEqual({
      all: 3,
      todo: 1,
      'in-progress': 1,
      done: 1,
    });
  });

  it('should filter by status', () => {
    const tasks = [
      createTask({ id: 1, status: 'todo' }),
      createTask({ id: 2, status: 'in-progress' }),
      createTask({ id: 3, status: 'done' }),
    ];

    const { result } = renderHook(() =>
      useFilteredTasks({ ...defaultProps, tasks, filter: 'todo' }),
    );

    expect(result.current.filteredTasks).toHaveLength(1);
    expect(result.current.filteredTasks[0].status).toBe('todo');
  });

  it('should filter by theme', () => {
    const tasks = [
      createTask({ id: 1, themeId: 1 }),
      createTask({ id: 2, themeId: 2 }),
      createTask({ id: 3, themeId: null }),
    ];

    const { result } = renderHook(() =>
      useFilteredTasks({ ...defaultProps, tasks, themeFilter: 1 }),
    );

    expect(result.current.filteredTasks).toHaveLength(1);
    expect(result.current.filteredTasks[0].id).toBe(1);
  });

  it('should filter by category', () => {
    const tasks = [
      createTask({ id: 1, themeId: 1 }),
      createTask({ id: 2, themeId: 3 }),
    ];

    const { result } = renderHook(() =>
      useFilteredTasks({ ...defaultProps, tasks, categoryFilter: 1 }),
    );

    expect(result.current.filteredTasks).toHaveLength(1);
    expect(result.current.filteredTasks[0].themeId).toBe(1);
  });

  it('should filter by priority', () => {
    const tasks = [
      createTask({ id: 1, priority: 'high' }),
      createTask({ id: 2, priority: 'low' }),
    ];

    const { result } = renderHook(() =>
      useFilteredTasks({ ...defaultProps, tasks, priorityFilter: 'high' }),
    );

    expect(result.current.filteredTasks).toHaveLength(1);
    expect(result.current.filteredTasks[0].priority).toBe('high');
  });

  it('should filter by search query', () => {
    const tasks = [
      createTask({ id: 1, title: 'Build API' }),
      createTask({ id: 2, title: 'Fix Bug' }),
    ];

    const { result } = renderHook(() =>
      useFilteredTasks({ ...defaultProps, tasks, searchQuery: 'api' }),
    );

    expect(result.current.filteredTasks).toHaveLength(1);
    expect(result.current.filteredTasks[0].title).toBe('Build API');
  });

  it('should exclude subtasks (parentId set)', () => {
    const tasks = [
      createTask({ id: 1, parentId: null }),
      createTask({ id: 2, parentId: 1 }),
    ];

    const { result } = renderHook(() =>
      useFilteredTasks({ ...defaultProps, tasks }),
    );

    expect(result.current.filteredTasks).toHaveLength(1);
    expect(result.current.filteredTasks[0].id).toBe(1);
  });

  it('should combine multiple filters', () => {
    const tasks = [
      createTask({
        id: 1,
        status: 'todo',
        priority: 'high',
        themeId: 1,
        title: 'Match',
      }),
      createTask({
        id: 2,
        status: 'todo',
        priority: 'low',
        themeId: 1,
        title: 'Match',
      }),
      createTask({
        id: 3,
        status: 'done',
        priority: 'high',
        themeId: 1,
        title: 'Match',
      }),
    ];

    const { result } = renderHook(() =>
      useFilteredTasks({
        ...defaultProps,
        tasks,
        filter: 'todo',
        priorityFilter: 'high',
        themeFilter: 1,
      }),
    );

    expect(result.current.filteredTasks).toHaveLength(1);
    expect(result.current.filteredTasks[0].id).toBe(1);
  });

  it('should handle empty tasks', () => {
    const { result } = renderHook(() =>
      useFilteredTasks({ ...defaultProps, tasks: [] }),
    );

    expect(result.current.filteredTasks).toHaveLength(0);
    expect(result.current.statusCounts.all).toBe(0);
  });
});
