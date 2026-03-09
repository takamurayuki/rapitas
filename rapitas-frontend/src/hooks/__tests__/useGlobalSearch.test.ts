import { renderHook, act } from '@testing-library/react';
import { useGlobalSearch, useSearchSuggest } from '../useGlobalSearch';

vi.mock('@/utils/api', () => ({
  API_BASE_URL: 'http://test:3001',
}));

describe('useGlobalSearch', () => {
  const mockResults = [
    { id: 1, type: 'task', title: 'Test Task', excerpt: 'excerpt', relevance: 1, metadata: {}, createdAt: '2026-01-01' },
  ];

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ results: mockResults, total: 1 }),
      }),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('should return initial state', () => {
    const { result } = renderHook(() => useGlobalSearch());
    expect(result.current.query).toBe('');
    expect(result.current.results).toEqual([]);
    expect(result.current.total).toBe(0);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('should search after debounce delay', async () => {
    const { result } = renderHook(() => useGlobalSearch({ debounceDelay: 300 }));

    act(() => {
      result.current.setQuery('test');
    });

    // Before debounce fires
    expect(fetch).not.toHaveBeenCalled();

    // Advance past debounce
    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('http://test:3001/search?'),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('should clear results when query is empty', async () => {
    const { result } = renderHook(() => useGlobalSearch());

    act(() => {
      result.current.setQuery('test');
    });

    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    act(() => {
      result.current.setQuery('');
    });

    expect(result.current.results).toEqual([]);
    expect(result.current.total).toBe(0);
  });

  it('should handle fetch error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
      }),
    );

    const { result } = renderHook(() => useGlobalSearch());

    act(() => {
      result.current.setQuery('error');
    });

    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    expect(result.current.error).toBe('検索に失敗しました');
  });

  it('should clear state with clear()', async () => {
    const { result } = renderHook(() => useGlobalSearch());

    act(() => {
      result.current.setQuery('test');
    });

    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    act(() => {
      result.current.clear();
    });

    expect(result.current.query).toBe('');
    expect(result.current.results).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  it('should reset offset when changing limit', () => {
    const { result } = renderHook(() => useGlobalSearch());

    act(() => {
      result.current.setOffset(10);
    });

    act(() => {
      result.current.setLimit(50);
    });

    expect(result.current.offset).toBe(0);
    expect(result.current.limit).toBe(50);
  });

  it('should reset offset when changing types', () => {
    const { result } = renderHook(() => useGlobalSearch());

    act(() => {
      result.current.setOffset(10);
    });

    act(() => {
      result.current.setTypes(['task']);
    });

    expect(result.current.offset).toBe(0);
    expect(result.current.types).toEqual(['task']);
  });

  it('should execute initial query immediately without debounce', async () => {
    const { result } = renderHook(() =>
      useGlobalSearch({ initialQuery: 'initial', debounceDelay: 300 }),
    );

    expect(result.current.query).toBe('initial');
    expect(result.current.loading).toBe(true);

    // Should fire immediately (delay=0 for initial query)
    await act(async () => {
      vi.advanceTimersByTime(0);
    });

    expect(fetch).toHaveBeenCalled();
  });
});

describe('useSearchSuggest', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            suggestions: [{ id: 1, title: 'Suggestion', type: 'task', status: 'open' }],
          }),
      }),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('should return initial state', () => {
    const { result } = renderHook(() => useSearchSuggest());
    expect(result.current.query).toBe('');
    expect(result.current.suggestions).toEqual([]);
  });

  it('should fetch suggestions after debounce', async () => {
    const { result } = renderHook(() => useSearchSuggest());

    act(() => {
      result.current.setQuery('test');
    });

    await act(async () => {
      vi.advanceTimersByTime(200);
    });

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/search/suggest?q=test'),
      expect.any(Object),
    );
  });

  it('should clear suggestions when query is empty', () => {
    const { result } = renderHook(() => useSearchSuggest());

    act(() => {
      result.current.setQuery('');
    });

    expect(result.current.suggestions).toEqual([]);
  });
});
