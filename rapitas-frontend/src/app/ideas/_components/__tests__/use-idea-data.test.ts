import { act, renderHook, waitFor } from '@testing-library/react';
import { useIdeaData } from '../use-idea-data';

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams('search=Recall'),
}));
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('@/utils/api', () => ({ API_BASE_URL: 'http://test' }));
vi.mock('@/stores/filter-data-store', () => ({
  useFilterDataStore: () => ({ themes: [] }),
}));
vi.mock('@/components/ui/toast/ToastContainer', () => ({
  useToast: () => ({ showToast: vi.fn() }),
}));
vi.mock('@/hooks/common/useLocalStorageState', () => ({
  useLocalStorageState: () => [10, vi.fn()],
}));

const page = (id: number) => ({
  ok: true,
  json: async () => ({ ideas: [{ id, title: 'Recall', content: 'Saved knowledge' }], total: 21 }),
});

describe('idea search pagination', () => {
  beforeEach(() => sessionStorage.clear());
  afterEach(() => vi.unstubAllGlobals());

  it('searches on the server and keeps the second result page visible', async () => {
    const fetchMock = vi.fn(async (url: string) =>
      url.includes('/stats')
        ? { ok: true, json: async () => ({ total: 21 }) }
        : page(url.includes('offset=10') ? 11 : 1),
    );
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useIdeaData());
    await waitFor(() => expect(result.current.paginatedFiltered[0]?.id).toBe(1));
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('search=Recall'));
    expect(result.current.displayTotalIdeas).toBe(21);
    expect(result.current.dynamicTotalPages).toBe(3);
    act(() => result.current.handlePageChange(2));
    await waitFor(() => expect(result.current.paginatedFiltered[0]?.id).toBe(11));
    expect(result.current.currentPage).toBe(2);
  });

  it('ignores a stale response after changing filters', async () => {
    let resolveOld!: (value: ReturnType<typeof page>) => void;
    const oldResponse = new Promise<ReturnType<typeof page>>((resolve) => {
      resolveOld = resolve;
    });
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (url.includes('/stats'))
          return Promise.resolve({ ok: true, json: async () => ({ total: 21 }) });
        return url.includes('priority=high') ? Promise.resolve(page(2)) : oldResponse;
      }),
    );
    const { result } = renderHook(() => useIdeaData());
    act(() => result.current.setPriorityFilter('high'));
    await waitFor(() => expect(result.current.paginatedFiltered[0]?.id).toBe(2));
    await act(async () => {
      resolveOld(page(1));
      await oldResponse;
    });
    expect(result.current.paginatedFiltered[0]?.id).toBe(2);
    expect(JSON.parse(sessionStorage.getItem('ideaBox.list-cache.v1')!).ideas[0].id).toBe(2);
  });
});
