import { renderHook, act, waitFor } from '@testing-library/react';
import { useKnowledgeSearch } from '../useKnowledgeSearch';

vi.mock('@/utils/api', () => ({
  API_BASE_URL: 'http://test:3001',
}));

describe('useKnowledgeSearch', () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch);
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('should return initial state', () => {
    const { result } = renderHook(() => useKnowledgeSearch());

    expect(result.current.results).toEqual([]);
    expect(result.current.isSearching).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('should return empty results for empty query', async () => {
    const { result } = renderHook(() => useKnowledgeSearch());

    let searchResult: unknown[];
    await act(async () => {
      searchResult = await result.current.search('  ');
    });

    expect(searchResult!).toEqual([]);
    expect(mockFetch).not.toHaveBeenCalled();
    expect(result.current.results).toEqual([]);
  });

  it('should search and return results', async () => {
    const mockResults = [
      { id: 1, title: 'Result 1', similarity: 0.95 },
      { id: 2, title: 'Result 2', similarity: 0.85 },
    ];
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ results: mockResults }),
    });

    const { result } = renderHook(() => useKnowledgeSearch());

    let searchResult: unknown[];
    await act(async () => {
      searchResult = await result.current.search('test query');
    });

    expect(searchResult!).toEqual(mockResults);
    expect(result.current.results).toEqual(mockResults);
    expect(result.current.isSearching).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('should build correct URL with query params', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ results: [] }),
    });

    const { result } = renderHook(() => useKnowledgeSearch());

    await act(async () => {
      await result.current.search('test', {
        limit: 10,
        minSimilarity: 0.5,
        category: 'procedure',
        themeId: 3,
      });
    });

    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain('http://test:3001/knowledge/search?');
    expect(calledUrl).toContain('q=test');
    expect(calledUrl).toContain('limit=10');
    expect(calledUrl).toContain('minSimilarity=0.5');
    expect(calledUrl).toContain('category=procedure');
    expect(calledUrl).toContain('themeId=3');
  });

  it('should handle fetch errors', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'));

    const { result } = renderHook(() => useKnowledgeSearch());

    let searchResult: unknown[];
    await act(async () => {
      searchResult = await result.current.search('test');
    });

    expect(searchResult!).toEqual([]);
    expect(result.current.error).toBe('Network error');
    expect(result.current.isSearching).toBe(false);
  });

  it('should handle non-ok response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
    });

    const { result } = renderHook(() => useKnowledgeSearch());

    await act(async () => {
      await result.current.search('test');
    });

    expect(result.current.error).toBe('Search failed');
  });

  it('should set isSearching during search', async () => {
    let resolvePromise: (value: unknown) => void;
    const fetchPromise = new Promise((resolve) => {
      resolvePromise = resolve;
    });
    mockFetch.mockReturnValueOnce(fetchPromise);

    const { result } = renderHook(() => useKnowledgeSearch());

    let searchPromise: Promise<unknown>;
    act(() => {
      searchPromise = result.current.search('test');
    });

    expect(result.current.isSearching).toBe(true);

    await act(async () => {
      resolvePromise!({ ok: true, json: async () => ({ results: [] }) });
      await searchPromise;
    });

    expect(result.current.isSearching).toBe(false);
  });

  it('should clearResults reset results and error', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ results: [{ id: 1 }] }),
    });

    const { result } = renderHook(() => useKnowledgeSearch());

    await act(async () => {
      await result.current.search('test');
    });

    expect(result.current.results).toHaveLength(1);

    act(() => {
      result.current.clearResults();
    });

    expect(result.current.results).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  it('should handle non-Error thrown values', async () => {
    mockFetch.mockRejectedValueOnce('string error');

    const { result } = renderHook(() => useKnowledgeSearch());

    await act(async () => {
      await result.current.search('test');
    });

    expect(result.current.error).toBe('string error');
  });
});
