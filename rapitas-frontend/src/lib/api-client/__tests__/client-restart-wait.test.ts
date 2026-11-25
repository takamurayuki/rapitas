/**
 * client-restart-wait.test
 *
 * APIClient across a backend restart (task 1548), with fake timers standing in
 * for the 36-63 s outage: a GET that fails to connect waits for `/health` and
 * succeeds without reaching the caller's error handler; a mutation is held
 * while a restart is known and sent exactly once, and never re-sent after a
 * failure; past the 2-minute ceiling the original error reaches the caller.
 */
import { APIClient } from '../client';
import { resetRestartWaitForTests } from '../restart-wait';
import { isServerRestarting, useServerRestartStore } from '@/stores/server-restart-store';

vi.mock('@/utils/api', () => ({ API_BASE_URL: 'http://test:3001' }));

const mockOfflineFetch = vi.fn();
vi.mock('@/lib/offline-queue', () => ({
  offlineFetch: (...args: unknown[]) => mockOfflineFetch(...args),
}));

/** Global fetch is only used for the `/health` probe here; offlineFetch carries the API calls. */
const healthFetch = vi.fn();

const okResponse = (body: unknown) =>
  ({ ok: true, status: 200, json: async () => body }) as unknown as Response;
const down = () => new TypeError('Failed to fetch');

/** Track settle state so "still waiting" can be asserted at a given fake time. */
function track<T>(promise: Promise<T>) {
  const state: { settled: boolean; value?: T; error?: unknown } = { settled: false };
  promise.then(
    (value) => Object.assign(state, { settled: true, value }),
    (error) => Object.assign(state, { settled: true, error }),
  );
  return state;
}

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  mockOfflineFetch.mockReset();
  healthFetch.mockReset();
  vi.stubGlobal('fetch', healthFetch);
  resetRestartWaitForTests();
  useServerRestartStore.getState().setRestarting(false);
});

afterEach(() => {
  useServerRestartStore.getState().setRestarting(false);
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('GET during a backend restart', () => {
  it('is re-sent after /health recovers and succeeds without an error toast', async () => {
    mockOfflineFetch
      .mockRejectedValueOnce(down())
      .mockRejectedValueOnce(down())
      .mockRejectedValueOnce(down())
      .mockResolvedValueOnce(okResponse({ id: 7, title: 'ok' }));
    healthFetch
      .mockRejectedValueOnce(down())
      .mockRejectedValueOnce(down())
      .mockResolvedValue(okResponse({ status: 'healthy', ready: true }));
    const overlay: boolean[] = [];
    const unsubscribe = useServerRestartStore.subscribe((s) => overlay.push(s.isRestarting));
    // What a screen does with a failed request: catch it and show a toast.
    const showToast = vi.fn();

    const result = new APIClient()
      .fetch<{ id: number }>('/tasks/7', { skipCache: true })
      .catch((err: unknown) => {
        showToast(err);
        return null;
      });
    await vi.advanceTimersByTimeAsync(10_000);
    unsubscribe();

    expect(await result).toEqual({ id: 7, title: 'ok' });
    expect(showToast).not.toHaveBeenCalled();
    expect(mockOfflineFetch).toHaveBeenCalledTimes(4);
    expect(overlay).toEqual([true, false]); // "restarting" shown, then cleared on recovery
    expect(isServerRestarting()).toBe(false);
  });

  it('a GET issued while a restart is known waits instead of burning attempts', async () => {
    useServerRestartStore.getState().setRestarting(true); // e.g. the SSE shutdown event
    healthFetch.mockRejectedValueOnce(down()).mockResolvedValue(okResponse({ ready: true }));
    mockOfflineFetch.mockResolvedValue(okResponse({ id: 1 }));

    const state = track(new APIClient().fetch('/tasks/1', { skipCache: true }));
    await vi.advanceTimersByTimeAsync(500);
    expect(mockOfflineFetch).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(state).toMatchObject({ settled: true, value: { id: 1 } });
    expect(mockOfflineFetch).toHaveBeenCalledTimes(1);
  });

  it('gives up after 2 minutes and the original error reaches the caller', async () => {
    mockOfflineFetch.mockRejectedValue(down());
    healthFetch.mockRejectedValue(down());

    const state = track(new APIClient().fetch('/tasks/9', { skipCache: true }));
    await vi.advanceTimersByTimeAsync(119_000);
    expect(state.settled).toBe(false);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(state.settled).toBe(true);
    expect(String(state.error)).toContain('Failed to fetch');
    expect(isServerRestarting()).toBe(false);
  });

  it('stops after 3 recoveries when the same GET keeps failing to connect', async () => {
    mockOfflineFetch.mockRejectedValue(down());
    healthFetch.mockResolvedValue(okResponse({ ready: true }));

    const state = track(new APIClient().fetch('/tasks/3', { skipCache: true }));
    await vi.advanceTimersByTimeAsync(20_000);
    expect(String(state.error)).toContain('Failed to fetch');
    expect(mockOfflineFetch).toHaveBeenCalledTimes(12); // (1 + 2 retries) x (1 + 3 waits)
  });

  it('does not wait on a 4xx/5xx answer (the backend is up)', async () => {
    mockOfflineFetch.mockResolvedValue({
      ok: false,
      status: 404,
      text: async () => 'missing',
    } as unknown as Response);

    const state = track(new APIClient().fetch('/tasks/404', { skipCache: true }));
    await vi.advanceTimersByTimeAsync(0);
    expect(String(state.error)).toContain('API Error: 404');
    expect(healthFetch).not.toHaveBeenCalled();
  });

  it('skipRetry GETs do not wait for recovery', async () => {
    mockOfflineFetch.mockRejectedValue(down());
    const state = track(new APIClient().fetch('/x', { skipCache: true, skipRetry: true }));
    await vi.advanceTimersByTimeAsync(0);
    expect(String(state.error)).toContain('Failed to fetch');
    expect(healthFetch).not.toHaveBeenCalled();
  });
});

describe('mutations during a backend restart', () => {
  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])(
    'a %s issued while restarting is held, then sent exactly once',
    async (method) => {
      useServerRestartStore.getState().setRestarting(true);
      healthFetch
        .mockRejectedValueOnce(down())
        .mockRejectedValueOnce(down())
        .mockResolvedValue(okResponse({ ready: true }));
      mockOfflineFetch.mockResolvedValue(okResponse({ saved: true }));

      const state = track(new APIClient().fetch('/tasks/5', { method, body: '{}' }));
      await vi.advanceTimersByTimeAsync(1_500);
      expect(mockOfflineFetch).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(5_000);
      expect(mockOfflineFetch).toHaveBeenCalledTimes(1);
      expect(state).toMatchObject({ settled: true, value: { saved: true } });
    },
  );

  it('a mutation that fails after sending is not re-sent and the error reaches the caller', async () => {
    mockOfflineFetch.mockRejectedValue(down());
    healthFetch.mockResolvedValue(okResponse({ ready: true }));

    const state = track(new APIClient().fetch('/tasks', { method: 'POST', body: '{}' }));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(String(state.error)).toContain('Failed to fetch');
    expect(mockOfflineFetch).toHaveBeenCalledTimes(1);
  });

  it('the one send after recovery is not repeated when it fails too', async () => {
    useServerRestartStore.getState().setRestarting(true);
    healthFetch.mockResolvedValue(okResponse({ ready: true }));
    mockOfflineFetch.mockRejectedValue(down());

    const state = track(new APIClient().fetch('/tasks/6', { method: 'PATCH', body: '{}' }));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(String(state.error)).toContain('Failed to fetch');
    expect(mockOfflineFetch).toHaveBeenCalledTimes(1);
  });

  it('past the 2-minute ceiling a held mutation is sent once and its result returned', async () => {
    useServerRestartStore.getState().setRestarting(true);
    healthFetch.mockRejectedValue(down());
    mockOfflineFetch.mockRejectedValue(down());

    const state = track(new APIClient().fetch('/tasks/8', { method: 'POST', body: '{}' }));
    await vi.advanceTimersByTimeAsync(119_000);
    expect(mockOfflineFetch).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(mockOfflineFetch).toHaveBeenCalledTimes(1);
    expect(String(state.error)).toContain('Failed to fetch');
  });
});
