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

/** /health that fails until `upAt` (epoch ms), then answers ready. */
function healthUpAt(getUpAt: () => number) {
  healthFetch.mockImplementation(async () => {
    if (Date.now() >= getUpAt()) return okResponse({ ready: true });
    throw down();
  });
}

// Task 1548 re-verification: one deadline per GET, and no recovery past it.
describe('GET deadline across a backend restart', () => {
  it('a recovery 1 s before the deadline re-sends and returns the result', async () => {
    const startedAt = Date.now();
    healthUpAt(() => startedAt + 900 + 120_000 - 1_000); // failures end ~0.9 s in
    mockOfflineFetch
      .mockRejectedValueOnce(down())
      .mockRejectedValueOnce(down())
      .mockRejectedValueOnce(down())
      .mockResolvedValueOnce(okResponse({ id: 11 }));

    const state = track(new APIClient().fetch('/tasks/11', { skipCache: true }));
    await vi.advanceTimersByTimeAsync(121_500);
    expect(state).toMatchObject({ settled: true, value: { id: 11 } });
    expect(mockOfflineFetch).toHaveBeenCalledTimes(4);
  });

  it('a recovery after the deadline does not re-send; the original error is returned', async () => {
    const startedAt = Date.now();
    // A slow /health (1.5 s per answer) that is up from ~the deadline on: the
    // probe in flight at the deadline answers "up" just after it (the verifier's case).
    healthFetch.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 1_500));
      if (Date.now() >= startedAt + 120_000) return okResponse({ ready: true });
      throw down();
    });
    mockOfflineFetch.mockRejectedValueOnce(down()).mockRejectedValueOnce(down());
    mockOfflineFetch.mockRejectedValueOnce(down()).mockResolvedValue(okResponse({ late: true }));

    const state = track(new APIClient().fetch('/tasks/12', { skipCache: true }));
    await vi.advanceTimersByTimeAsync(119_000);
    expect(state.settled).toBe(false);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(String(state.error)).toContain('Failed to fetch');
    const sendsAtDeadline = mockOfflineFetch.mock.calls.length;
    await vi.advanceTimersByTimeAsync(10_000); // /health comes up at 125 s
    expect(mockOfflineFetch).toHaveBeenCalledTimes(sendsAtDeadline);
    expect(sendsAtDeadline).toBe(3);
  });

  it.each([
    ['its result', () => mockOfflineFetch.mockResolvedValue(okResponse({ once: true }))],
    ['its real error', () => mockOfflineFetch.mockRejectedValue(down())],
  ])('a held GET past the deadline is sent once and returns %s', async (_label, arrange) => {
    useServerRestartStore.getState().setRestarting(true);
    healthFetch.mockRejectedValue(down());
    arrange();

    const state = track(new APIClient().fetch('/tasks/13', { skipCache: true }));
    await vi.advanceTimersByTimeAsync(119_000);
    expect(mockOfflineFetch).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(state.settled).toBe(true);
    expect(mockOfflineFetch).toHaveBeenCalledTimes(1);
    if (state.error) expect(String(state.error)).toContain('Failed to fetch');
    else expect(state.value).toEqual({ once: true });
    await vi.advanceTimersByTimeAsync(130_000); // never waits a second 2 minutes
    expect(mockOfflineFetch).toHaveBeenCalledTimes(1);
  });

  it('after the SSE notice the 2 minutes count from the notice, not from the GET', async () => {
    useServerRestartStore.getState().setRestarting(true); // t = 0, e.g. SSE shutdown
    healthFetch.mockRejectedValue(down());
    mockOfflineFetch.mockRejectedValue(down());
    await vi.advanceTimersByTimeAsync(60_000);

    const state = track(new APIClient().fetch('/tasks/14', { skipCache: true })); // t = 60 s
    await vi.advanceTimersByTimeAsync(59_000); // t = 119 s
    expect(state.settled).toBe(false);
    await vi.advanceTimersByTimeAsync(2_000); // t = 121 s
    expect(state.settled).toBe(true);
    expect(String(state.error)).toContain('Failed to fetch');
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
