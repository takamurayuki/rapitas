/**
 * useThemeCrud.test
 *
 * Verifies every fetch issued by useThemeCrud carries the UI source header
 * (x-rapitas-source: ui) and preserves caller-provided Content-Type headers.
 */
import { renderHook, act } from '@testing-library/react';
import { useThemeCrud } from '../useThemeCrud';
import type { Theme } from '@/types';
import type { DropResult } from '@hello-pangea/dnd';
import type { FormData } from '../useThemesPage';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock('@/components/ui/toast/ToastContainer', () => ({
  useToast: () => ({ showToast: vi.fn() }),
}));

vi.mock('@/components/ui/dialog/ConfirmDialogProvider', () => ({
  useConfirmDialog: () => () => Promise.resolve(true),
}));

vi.mock('@/utils/api', () => ({
  API_BASE_URL: 'http://test:3001',
}));

vi.mock('@/stores/filter-data-store', () => ({
  useFilterDataStore: (selector: (s: { clearCache: () => void }) => unknown) =>
    selector({ clearCache: vi.fn() }),
}));

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ error: vi.fn(), debug: vi.fn() }),
}));

const baseFormData: FormData = {
  name: 'Theme A',
  description: '',
  color: '#8B5CF6',
  icon: '',
  isDevelopment: false,
  repositoryUrl: '',
  workingDirectory: '',
  defaultBranch: 'develop',
  runtimeConfigJson: '',
  categoryId: 1,
};

type FetchCall = [RequestInfo | URL, RequestInit | undefined];

/** Extracts a header value from a recorded fetch call, normalizing HeadersInit. */
const headerOf = (call: FetchCall, name: string): string | null =>
  new Headers(call[1]?.headers).get(name);

describe('useThemeCrud UI source header coverage', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      // NOTE: json() serves the favorites GET (Array.isArray check); text() serves handleUpdate.
      json: () => Promise.resolve([]),
      text: () => Promise.resolve('{}'),
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  const renderCrud = (formData: FormData = baseFormData) =>
    renderHook(() =>
      useThemeCrud({
        getFormData: () => formData,
        fetchItems: vi.fn(),
      }),
    );

  it('handleAdd (non-dev) sends POST /themes with UI header and preserved Content-Type', async () => {
    const { result } = renderCrud();

    await act(async () => {
      await result.current.handleAdd(vi.fn());
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0] as FetchCall;
    expect(call[0]).toBe('http://test:3001/themes');
    expect(call[1]?.method).toBe('POST');
    expect(headerOf(call, 'x-rapitas-source')).toBe('ui');
    expect(headerOf(call, 'content-type')).toBe('application/json');
  });

  it('handleAdd (dev) also tags the favorites GET/POST with the UI header', async () => {
    const { result } = renderCrud({
      ...baseFormData,
      isDevelopment: true,
      repositoryUrl: 'https://github.com/example/repo',
      workingDirectory: 'C:/work/repo',
    });

    await act(async () => {
      await result.current.handleAdd(vi.fn());
    });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const [themesPost, favoritesGet, favoritesPost] = fetchMock.mock.calls as FetchCall[];

    expect(themesPost[0]).toBe('http://test:3001/themes');
    expect(headerOf(themesPost, 'x-rapitas-source')).toBe('ui');

    expect(favoritesGet[0]).toBe('http://test:3001/directories/favorites');
    expect(favoritesGet[1]?.method).toBeUndefined();
    expect(headerOf(favoritesGet, 'x-rapitas-source')).toBe('ui');

    expect(favoritesPost[0]).toBe('http://test:3001/directories/favorites');
    expect(favoritesPost[1]?.method).toBe('POST');
    expect(headerOf(favoritesPost, 'x-rapitas-source')).toBe('ui');
    expect(headerOf(favoritesPost, 'content-type')).toBe('application/json');
  });

  it('handleUpdate sends PATCH /themes/:id with UI header and preserved Content-Type', async () => {
    const { result } = renderCrud();

    await act(async () => {
      await result.current.handleUpdate(5, vi.fn());
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0] as FetchCall;
    expect(call[0]).toBe('http://test:3001/themes/5');
    expect(call[1]?.method).toBe('PATCH');
    expect(headerOf(call, 'x-rapitas-source')).toBe('ui');
    expect(headerOf(call, 'content-type')).toBe('application/json');
  });

  it('handleDelete (confirm accepted) sends DELETE with UI header', async () => {
    const { result } = renderCrud();

    await act(async () => {
      await result.current.handleDelete(7, 'Theme A');
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0] as FetchCall;
    expect(call[0]).toBe('http://test:3001/themes/7');
    expect(call[1]?.method).toBe('DELETE');
    expect(headerOf(call, 'x-rapitas-source')).toBe('ui');
  });

  it('setDefault sends PATCH /themes/:id/set-default with UI header', async () => {
    const { result } = renderCrud();

    await act(async () => {
      await result.current.setDefault(9);
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0] as FetchCall;
    expect(call[0]).toBe('http://test:3001/themes/9/set-default');
    expect(call[1]?.method).toBe('PATCH');
    expect(headerOf(call, 'x-rapitas-source')).toBe('ui');
  });

  it('handleDragEnd sends PATCH /themes/reorder with UI header and preserved Content-Type', async () => {
    const { result } = renderCrud();

    const items = [
      { id: 1, categoryId: 1, sortOrder: 0 },
      { id: 2, categoryId: 1, sortOrder: 1 },
    ] as unknown as Theme[];

    const dropResult = {
      source: { index: 0, droppableId: 'themes-category-1' },
      destination: { index: 1, droppableId: 'themes-category-1' },
    } as DropResult;

    await act(async () => {
      await result.current.handleDragEnd(dropResult, items, vi.fn());
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0] as FetchCall;
    expect(call[0]).toBe('http://test:3001/themes/reorder');
    expect(call[1]?.method).toBe('PATCH');
    expect(headerOf(call, 'x-rapitas-source')).toBe('ui');
    expect(headerOf(call, 'content-type')).toBe('application/json');
  });
});
