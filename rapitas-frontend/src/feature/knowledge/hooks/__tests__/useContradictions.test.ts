import { renderHook, act, waitFor } from '@testing-library/react';
import { useContradictions } from '../useContradictions';

vi.mock('@/utils/api', () => ({
  API_BASE_URL: 'http://test:3001',
}));

describe('useContradictions', () => {
  const mockFetch = vi.fn();

  const mockContradictions = [
    {
      id: 1,
      entryAId: 10,
      entryBId: 20,
      contradictionType: 'semantic',
      description: 'Conflicting info',
      resolution: null,
      resolvedAt: null,
      createdAt: '2026-01-01',
      entryA: {
        id: 10,
        title: 'Entry A',
        content: 'Content A',
        category: 'fact',
        confidence: 0.8,
      },
      entryB: {
        id: 20,
        title: 'Entry B',
        content: 'Content B',
        category: 'fact',
        confidence: 0.7,
      },
    },
  ];

  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch);
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('should fetch contradictions on mount', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockContradictions,
    });

    const { result } = renderHook(() => useContradictions());

    expect(result.current.isLoading).toBe(true);

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.contradictions).toEqual(mockContradictions);
    expect(result.current.error).toBeNull();
    expect(mockFetch).toHaveBeenCalledWith(
      'http://test:3001/memory/contradictions?limit=20',
    );
  });

  it('should use custom limit', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [],
    });

    renderHook(() => useContradictions(5));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        'http://test:3001/memory/contradictions?limit=5',
      );
    });
  });

  it('should handle fetch errors', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'));

    const { result } = renderHook(() => useContradictions());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.error).toBe('Network error');
    expect(result.current.contradictions).toEqual([]);
  });

  it('should handle non-ok response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
    });

    const { result } = renderHook(() => useContradictions());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.error).toBe('Failed to fetch contradictions');
  });

  it('should refetch contradictions when refetch is called', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [],
    });

    const { result } = renderHook(() => useContradictions());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockContradictions,
    });

    await act(async () => {
      await result.current.refetch();
    });

    expect(result.current.contradictions).toEqual(mockContradictions);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('should resolve a contradiction and refetch', async () => {
    // Initial fetch
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockContradictions,
    });

    const { result } = renderHook(() => useContradictions());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    // Resolve call
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({}),
    });

    // Refetch after resolve
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [],
    });

    await act(async () => {
      await result.current.resolve(1, 'keep_a');
    });

    // Check resolve was called correctly
    expect(mockFetch).toHaveBeenCalledWith(
      'http://test:3001/memory/contradictions/1/resolve',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resolution: 'keep_a' }),
      },
    );

    // After resolve, contradictions should be refetched (empty now)
    expect(result.current.contradictions).toEqual([]);
  });

  it('should throw error when resolve fails', async () => {
    // Initial fetch
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockContradictions,
    });

    const { result } = renderHook(() => useContradictions());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    // Resolve call fails
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
    });

    await expect(
      act(async () => {
        await result.current.resolve(1, 'keep_b');
      }),
    ).rejects.toThrow('Failed to resolve contradiction');
  });

  it('should handle non-Error thrown values in fetch', async () => {
    mockFetch.mockRejectedValueOnce('string error');

    const { result } = renderHook(() => useContradictions());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.error).toBe('string error');
  });
});
