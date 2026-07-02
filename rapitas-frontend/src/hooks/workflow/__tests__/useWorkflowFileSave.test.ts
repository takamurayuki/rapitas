import { renderHook, act } from '@testing-library/react';
import { useWorkflowFileSave } from '../useWorkflowFileSave';

vi.mock('next-intl', () => {
  const t = (key: string) => key;
  return { useTranslations: () => t };
});

vi.mock('@/utils/api', () => ({
  API_BASE_URL: 'http://test:3001',
}));

describe('useWorkflowFileSave', () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch);
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns initial state', () => {
    const { result } = renderHook(() => useWorkflowFileSave(7));
    expect(result.current.isSaving).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('PUTs to the workflow file endpoint with the content body', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, workflowStatus: 'plan_created' }),
    });

    const { result } = renderHook(() => useWorkflowFileSave(42));
    let res: { success: boolean; workflowStatus?: string } | undefined;
    await act(async () => {
      res = await result.current.saveFile('plan', '# Plan\n- step');
    });

    expect(res!.success).toBe(true);
    expect(res!.workflowStatus).toBe('plan_created');
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe('http://test:3001/workflow/tasks/42/files/plan');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body)).toEqual({ content: '# Plan\n- step' });
  });

  it('surfaces the API error message on a non-ok response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 422,
      json: async () => ({ error: 'ログ汚染を検出' }),
    });

    const { result } = renderHook(() => useWorkflowFileSave(1));
    let res: { success: boolean; error?: string } | undefined;
    await act(async () => {
      res = await result.current.saveFile('plan', 'x');
    });

    expect(res!.success).toBe(false);
    expect(res!.error).toBe('ログ汚染を検出');
    expect(result.current.error).toBe('ログ汚染を検出');
  });

  it('handles a network error', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'));

    const { result } = renderHook(() => useWorkflowFileSave(1));
    let res: { success: boolean; error?: string } | undefined;
    await act(async () => {
      res = await result.current.saveFile('plan', 'x');
    });

    expect(res!.success).toBe(false);
    expect(res!.error).toBe('Network error');
  });

  it('clearError resets the error', async () => {
    mockFetch.mockRejectedValueOnce(new Error('boom'));
    const { result } = renderHook(() => useWorkflowFileSave(1));
    await act(async () => {
      await result.current.saveFile('plan', 'x');
    });
    expect(result.current.error).toBe('boom');

    act(() => result.current.clearError());
    expect(result.current.error).toBeNull();
  });
});
