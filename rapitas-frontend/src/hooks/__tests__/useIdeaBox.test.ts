import { renderHook, waitFor, act } from '@testing-library/react';
import { useIdeaBox } from '../feature/useIdeaBox';

vi.mock('next-intl', () => {
  const t = (key: string) => key;
  return { useTranslations: () => t };
});
vi.mock('@/utils/api', () => ({ API_BASE_URL: 'http://test:3001' }));

describe('useIdeaBox', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fetches ideas and stats on mount without a categoryId filter', async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url.includes('/stats')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ total: 1, unused: 1, byCategory: [] }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ ideas: [{ id: 1 }], total: 1 }),
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useIdeaBox(null));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.ideas).toEqual([{ id: 1 }]);
    expect(result.current.stats).toEqual({ total: 1, unused: 1, byCategory: [] });
    const [ideasUrl] = fetchMock.mock.calls.find(([u]) => !u.includes('/stats'))!;
    expect(ideasUrl).not.toContain('categoryId');
  });

  it('includes categoryId in the query when provided', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: () => Promise.resolve({ ideas: [], total: 0 }) });
    vi.stubGlobal('fetch', fetchMock);

    renderHook(() => useIdeaBox(7));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('categoryId=7'));
    });
  });

  it('sets an error message when the ideas fetch fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));

    const { result } = renderHook(() => useIdeaBox(null));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.error).toContain('HTTP 500');
  });

  it('stats fetch failure is non-fatal (stats stays null, no error set)', async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url.includes('/stats')) return Promise.reject(new Error('stats down'));
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ ideas: [], total: 0 }) });
    });
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useIdeaBox(null));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.stats).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it('submitIdea posts the idea then refreshes ideas and stats', async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (init?.method === 'POST') return Promise.resolve({ ok: true });
      if (url.includes('/stats')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ total: 1, unused: 1, byCategory: [] }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ ideas: [{ id: 9 }], total: 1 }),
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useIdeaBox(null));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.submitIdea('Title', 'Content', 'bug');
    });

    expect(result.current.isSubmitting).toBe(false);
    expect(result.current.ideas).toEqual([{ id: 9 }]);
    const postCall = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST');
    expect(postCall).toBeTruthy();
    expect(JSON.parse((postCall![1] as RequestInit).body as string)).toEqual({
      title: 'Title',
      content: 'Content',
      category: 'bug',
    });
  });

  it('submitIdea defaults category to "improvement" when omitted', async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (init?.method === 'POST') return Promise.resolve({ ok: true });
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ ideas: [], total: 0 }) });
    });
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useIdeaBox(null));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.submitIdea('T', 'C');
    });

    const postCall = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST');
    expect(JSON.parse((postCall![1] as RequestInit).body as string).category).toBe('improvement');
  });

  it('submitIdea sets an error on failure and resets isSubmitting', async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (init?.method === 'POST') return Promise.resolve({ ok: false, status: 400 });
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ ideas: [], total: 0 }) });
    });
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useIdeaBox(null));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.submitIdea('T', 'C');
    });

    expect(result.current.isSubmitting).toBe(false);
    expect(result.current.error).toContain('HTTP 400');
  });
});
