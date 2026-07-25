/**
 * useIdeaForm.test.ts
 *
 * flashKey propagation: bumped on a successful NEW-idea submission (drives the
 * lamp icon's one-shot "lit up" animation in idea-create-form.tsx), but never
 * on an edit or a failed submission.
 */
import { renderHook, act, waitFor } from '@testing-library/react';
import { useIdeaForm } from '../use-idea-form';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock('@/utils/api', () => ({ API_BASE_URL: 'http://test:3001' }));

const mockShowToast = vi.fn();
vi.mock('@/components/ui/toast/ToastContainer', () => ({
  useToast: () => ({ showToast: mockShowToast }),
}));

vi.mock('@/stores/filter-data-store', () => ({
  useFilterDataStore: () => ({ categories: [], themes: [] }),
}));

function setup() {
  const fetchIdeas = vi.fn().mockResolvedValue(undefined);
  const setIdeas = vi.fn();
  const { result } = renderHook(() => useIdeaForm({ fetchIdeas, setIdeas }));
  return { result, fetchIdeas, setIdeas };
}

describe('useIdeaForm — flashKey (lamp flash trigger)', () => {
  beforeEach(() => {
    mockShowToast.mockClear();
  });

  it('starts at 0 (no flash on mount)', () => {
    const { result } = setup();
    expect(result.current.flashKey).toBe(0);
  });

  it('increments after a successful new-idea submission', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
    const { result } = setup();

    act(() => result.current.setNewTitle('新しいアイデア'));
    await act(async () => {
      await result.current.handleSubmit();
    });

    await waitFor(() => expect(result.current.flashKey).toBe(1));
  });

  it('increments again on a second successful submission (re-triggerable)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
    const { result } = setup();

    act(() => result.current.setNewTitle('1件目'));
    await act(async () => {
      await result.current.handleSubmit();
    });
    await waitFor(() => expect(result.current.flashKey).toBe(1));

    act(() => result.current.setNewTitle('2件目'));
    await act(async () => {
      await result.current.handleSubmit();
    });
    await waitFor(() => expect(result.current.flashKey).toBe(2));
  });

  it('does NOT increment when the submission fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    const { result } = setup();

    act(() => result.current.setNewTitle('失敗するアイデア'));
    await act(async () => {
      await result.current.handleSubmit();
    });

    await waitFor(() => expect(mockShowToast).toHaveBeenCalled());
    expect(result.current.flashKey).toBe(0);
  });

  it('does NOT increment on an edit submission (only new-idea adds trigger the flash)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
    const { result } = setup();

    act(() =>
      result.current.handleEdit({
        id: 42,
        title: '既存のアイデア',
        content: '既存のアイデア',
        category: 'improvement',
        scope: 'project',
        priority: 'medium',
        tags: [],
        themeId: null,
        source: 'user',
        usedInTaskId: null,
        createdAt: new Date().toISOString(),
      }),
    );
    await act(async () => {
      await result.current.handleSubmit();
    });

    await waitFor(() => expect(result.current.showQuickAdd).toBe(false));
    expect(result.current.flashKey).toBe(0);
  });
});
