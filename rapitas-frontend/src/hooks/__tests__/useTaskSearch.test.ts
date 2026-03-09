import { renderHook, act, waitFor } from '@testing-library/react';
import { useTaskSearch, useAdvancedTaskSearch } from '../useTaskSearch';

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

const mockSearchTasks = vi.fn();

vi.mock('@/lib/task-api', () => ({
  searchTasks: (...args: unknown[]) => mockSearchTasks(...args),
}));

describe('useTaskSearch', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockSearchTasks.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should return empty results initially', () => {
    const { result } = renderHook(() => useTaskSearch());

    expect(result.current.query).toBe('');
    expect(result.current.results).toEqual([]);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('should not search when query length < minLength (default 2)', async () => {
    const { result } = renderHook(() => useTaskSearch());

    act(() => {
      result.current.setQuery('a');
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    expect(mockSearchTasks).not.toHaveBeenCalled();
    expect(result.current.results).toEqual([]);
  });

  it('should search after debounce delay', async () => {
    const mockTasks = [
      { id: 1, title: 'Test task', status: 'todo', createdAt: '2026-01-01' },
    ];
    mockSearchTasks.mockResolvedValueOnce(mockTasks);

    const { result } = renderHook(() => useTaskSearch());

    act(() => {
      result.current.setQuery('test');
    });

    // Before debounce
    expect(mockSearchTasks).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    expect(mockSearchTasks).toHaveBeenCalledWith('test');
    expect(result.current.results).toEqual(mockTasks);
  });

  it('should use custom debounce delay', async () => {
    mockSearchTasks.mockResolvedValueOnce([]);

    const { result } = renderHook(() => useTaskSearch({ debounceDelay: 500 }));

    act(() => {
      result.current.setQuery('test');
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    expect(mockSearchTasks).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });

    expect(mockSearchTasks).toHaveBeenCalledWith('test');
  });

  it('should use custom minLength', async () => {
    mockSearchTasks.mockResolvedValueOnce([]);

    const { result } = renderHook(() => useTaskSearch({ minLength: 4 }));

    act(() => {
      result.current.setQuery('abc');
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    expect(mockSearchTasks).not.toHaveBeenCalled();

    mockSearchTasks.mockResolvedValueOnce([]);

    act(() => {
      result.current.setQuery('abcd');
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    expect(mockSearchTasks).toHaveBeenCalledWith('abcd');
  });

  it('should clearSearch() clear results and query', () => {
    const { result } = renderHook(() => useTaskSearch());

    act(() => {
      result.current.setQuery('test');
    });

    act(() => {
      result.current.clearSearch();
    });

    expect(result.current.query).toBe('');
    expect(result.current.results).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  it('should handle search errors', async () => {
    mockSearchTasks.mockRejectedValueOnce(new Error('API error'));

    const { result } = renderHook(() => useTaskSearch());

    act(() => {
      result.current.setQuery('test');
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    expect(result.current.error).toBe('API error');
  });

  it('should reset debounce timer on rapid query changes', async () => {
    mockSearchTasks.mockResolvedValue([]);

    const { result } = renderHook(() => useTaskSearch({ debounceDelay: 300 }));

    act(() => {
      result.current.setQuery('te');
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });

    act(() => {
      result.current.setQuery('tes');
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });

    // Only 200ms since last change, should not have searched yet
    expect(mockSearchTasks).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    expect(mockSearchTasks).toHaveBeenCalledWith('tes');
    expect(mockSearchTasks).toHaveBeenCalledTimes(1);
  });

  it('should clear results when query is set to empty string', () => {
    const { result } = renderHook(() => useTaskSearch());

    act(() => {
      result.current.setQuery('test');
    });

    act(() => {
      result.current.setQuery('');
    });

    expect(result.current.results).toEqual([]);
  });
});

describe('useAdvancedTaskSearch', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockSearchTasks.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should filter results by status', async () => {
    const mockTasks = [
      { id: 1, title: 'Task 1', status: 'todo', createdAt: '2026-01-01' },
      { id: 2, title: 'Task 2', status: 'done', createdAt: '2026-01-01' },
    ];
    mockSearchTasks.mockResolvedValueOnce(mockTasks);

    const { result } = renderHook(() =>
      useAdvancedTaskSearch({ status: ['todo'] }),
    );

    act(() => {
      result.current.setQuery('Task');
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    expect(result.current.results).toHaveLength(1);
    expect(result.current.results[0].id).toBe(1);
    expect(result.current.totalResults).toBe(2);
  });

  it('should filter results by categoryId', async () => {
    const mockTasks = [
      {
        id: 1,
        title: 'Task 1',
        status: 'todo',
        createdAt: '2026-01-01',
        theme: { categoryId: 1 },
      },
      {
        id: 2,
        title: 'Task 2',
        status: 'todo',
        createdAt: '2026-01-01',
        theme: { categoryId: 2 },
      },
    ];
    mockSearchTasks.mockResolvedValueOnce(mockTasks);

    const { result } = renderHook(() =>
      useAdvancedTaskSearch({ categoryId: 1 }),
    );

    act(() => {
      result.current.setQuery('Task');
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    expect(result.current.results).toHaveLength(1);
    expect(result.current.results[0].id).toBe(1);
  });

  it('should clearAllFilters clear filters and search', () => {
    const { result } = renderHook(() =>
      useAdvancedTaskSearch({ status: ['todo'] }),
    );

    act(() => {
      result.current.clearAllFilters();
    });

    expect(result.current.query).toBe('');
    expect(result.current.results).toEqual([]);
  });
});
