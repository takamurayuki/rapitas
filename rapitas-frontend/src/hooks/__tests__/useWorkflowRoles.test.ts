import { renderHook, waitFor, act } from '@testing-library/react';
import { useWorkflowRoles } from '../workflow/useWorkflowRoles';

vi.mock('next-intl', () => {
  const t = (key: string) => key;
  return { useTranslations: () => t };
});
vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));
vi.mock('@/utils/api', () => ({ API_BASE_URL: 'http://test:3001' }));

describe('useWorkflowRoles', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fetches roles on mount and turns off loading', async () => {
    const roles = [{ role: 'researcher', agentConfigId: 1 }];
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(roles) }),
    );

    const { result } = renderHook(() => useWorkflowRoles());
    expect(result.current.isLoading).toBe(true);

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.roles).toEqual(roles);
    expect(result.current.error).toBeNull();
  });

  it('sets an error message on a failed fetch', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));

    const { result } = renderHook(() => useWorkflowRoles());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.error).toContain('500');
    expect(result.current.roles).toEqual([]);
  });

  it('updateRole PUTs the update and replaces the matching role in state', async () => {
    const initial = [{ role: 'researcher', agentConfigId: 1 }];
    const updated = { role: 'researcher', agentConfigId: 2 };
    const fetchMock = vi.fn();
    fetchMock.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(initial) }); // initial GET
    fetchMock.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(updated) }); // PUT
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useWorkflowRoles());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    let outcome;
    await act(async () => {
      outcome = await result.current.updateRole('researcher', { agentConfigId: 2 });
    });

    expect(outcome).toEqual({ success: true });
    expect(result.current.roles).toEqual([updated]);
    expect(fetchMock).toHaveBeenLastCalledWith(
      'http://test:3001/workflow-roles/researcher',
      expect.objectContaining({ method: 'PUT' }),
    );
  });

  it('updateRole returns a failure result and sets error on a bad response', async () => {
    const fetchMock = vi.fn();
    fetchMock.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve([]) }); // initial GET
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: () => Promise.resolve({ error: 'bad role' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useWorkflowRoles());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    let outcome;
    await act(async () => {
      outcome = await result.current.updateRole('planner', { isEnabled: false });
    });

    expect(outcome).toEqual({ success: false, error: 'bad role' });
    expect(result.current.error).toBe('bad role');
  });

  it('refetch re-runs the GET request', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve([]) });
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useWorkflowRoles());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const callsBefore = fetchMock.mock.calls.length;
    await act(async () => {
      await result.current.refetch();
    });

    expect(fetchMock.mock.calls.length).toBe(callsBefore + 1);
  });
});
