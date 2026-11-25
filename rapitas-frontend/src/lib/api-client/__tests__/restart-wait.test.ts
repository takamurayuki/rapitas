/**
 * restart-wait.test
 *
 * The `/health` probe loop behind the API client's restart wait: connection
 * error recognition, one shared loop for concurrent waiters, `ready:false`
 * treated as not back yet, no overlay for a blip the first probe sees
 * through, the 2-minute ceiling measured from the restart's start, and
 * holdUntilBackendReady returning at once when nothing is restarting.
 */
import {
  holdUntilBackendReady,
  isConnectionError,
  noteConnectionFailure,
  resetRestartWaitForTests,
  waitForBackendRecovery,
} from '../restart-wait';
import {
  isServerRestarting,
  MAX_RESTART_MS,
  useServerRestartStore,
} from '@/stores/server-restart-store';

const BASE = 'http://test:3001';
const healthFetch = vi.fn();
const health = (body: unknown, ok = true) =>
  ({ ok, status: ok ? 200 : 503, json: async () => body }) as unknown as Response;
const down = () => new TypeError('Failed to fetch');

beforeEach(() => {
  vi.useFakeTimers();
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

describe('isConnectionError', () => {
  it.each([
    new TypeError('Failed to fetch'),
    new TypeError('NetworkError when attempting to fetch resource.'),
    new TypeError('Load failed'),
    new Error('Request timeout after 15002ms — GET /tasks/1'),
    new Error('connect ECONNREFUSED 127.0.0.1:3001'),
    new Error('read ECONNRESET'),
  ])('treats "%s" as a connection error', (err) => {
    expect(isConnectionError(err)).toBe(true);
  });

  it('reads the cause of an annotated error', () => {
    const wrapped = new Error('something — GET /x');
    (wrapped as Error & { cause?: unknown }).cause = new TypeError('Failed to fetch');
    expect(isConnectionError(wrapped)).toBe(true);
  });

  it.each([
    new Error('API Error: 503 (GET /x) - down'),
    new Error('API Error: 404 (GET /x) - missing'),
    new Error('boom'),
    'plain string',
    null,
  ])('does not treat %s as a connection error', (err) => {
    expect(isConnectionError(err)).toBe(false);
  });
});

describe('waitForBackendRecovery', () => {
  it('concurrent waiters share one probe loop', async () => {
    healthFetch.mockRejectedValueOnce(down()).mockResolvedValue(health({ ready: true }));
    const a = waitForBackendRecovery(BASE);
    const b = waitForBackendRecovery(BASE);
    await vi.advanceTimersByTimeAsync(1_500);
    expect(await a).toBe(true);
    expect(await b).toBe(true);
    expect(healthFetch).toHaveBeenCalledTimes(2);
    expect(healthFetch.mock.calls[0][0]).toBe(`${BASE}/health`);
  });

  it('ready:false (warm-up still writing) is not recovered yet', async () => {
    healthFetch
      .mockResolvedValueOnce(health({ status: 'healthy', ready: false }))
      .mockResolvedValue(health({ status: 'healthy', ready: true }));
    const result = waitForBackendRecovery(BASE);
    await vi.advanceTimersByTimeAsync(0);
    expect(isServerRestarting()).toBe(true);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await result).toBe(true);
    expect(healthFetch).toHaveBeenCalledTimes(2);
  });

  it('a non-2xx /health is not recovered; a body without ready is', async () => {
    healthFetch.mockResolvedValueOnce(health({}, false)).mockResolvedValue(health({ ok: 1 }));
    const result = waitForBackendRecovery(BASE);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await result).toBe(true);
  });

  it('does not show the overlay when the first probe already succeeds', async () => {
    const setRestarting = vi.spyOn(useServerRestartStore.getState(), 'setRestarting');
    healthFetch.mockResolvedValue(health({ ready: true }));
    expect(await waitForBackendRecovery(BASE)).toBe(true);
    expect(setRestarting).not.toHaveBeenCalled();
    setRestarting.mockRestore();
  });

  it('a probe that hangs is abandoned after 2 s and retried', async () => {
    healthFetch
      .mockImplementationOnce(
        (_url: string, init: RequestInit) =>
          new Promise((_, reject) => init.signal!.addEventListener('abort', () => reject(down()))),
      )
      .mockResolvedValue(health({ ready: true }));
    const result = waitForBackendRecovery(BASE);
    await vi.advanceTimersByTimeAsync(3_100);
    expect(await result).toBe(true);
    expect(healthFetch).toHaveBeenCalledTimes(2);
  });

  it('gives up at the ceiling measured from when the restart started', async () => {
    healthFetch.mockRejectedValue(down());
    useServerRestartStore.getState().setRestarting(true); // started now
    await vi.advanceTimersByTimeAsync(60_000);
    const state = { done: false, value: undefined as boolean | undefined };
    void waitForBackendRecovery(BASE).then((v) => Object.assign(state, { done: true, value: v }));
    // Only the remaining 60 s are waited, not a fresh 120 s.
    await vi.advanceTimersByTimeAsync(MAX_RESTART_MS - 60_000 - 1_000);
    expect(state.done).toBe(false);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(state).toEqual({ done: true, value: false });
    expect(isServerRestarting()).toBe(false);
  });

  it('a new loop starts after the previous one finished', async () => {
    healthFetch.mockResolvedValue(health({ ready: true }));
    await waitForBackendRecovery(BASE);
    await waitForBackendRecovery(BASE);
    expect(healthFetch).toHaveBeenCalledTimes(2);
  });
});

describe('holdUntilBackendReady / noteConnectionFailure', () => {
  it('returns at once (no probe) when nothing is restarting', async () => {
    await holdUntilBackendReady(BASE);
    expect(healthFetch).not.toHaveBeenCalled();
  });

  it('waits while restarting', async () => {
    useServerRestartStore.getState().setRestarting(true);
    healthFetch.mockRejectedValueOnce(down()).mockResolvedValue(health({ ready: true }));
    let released = false;
    void holdUntilBackendReady(BASE).then(() => (released = true));
    await vi.advanceTimersByTimeAsync(500);
    expect(released).toBe(false);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(released).toBe(true);
  });

  it('noteConnectionFailure starts the watch without waiting, and later holds join it', async () => {
    healthFetch.mockRejectedValueOnce(down()).mockResolvedValue(health({ ready: true }));
    noteConnectionFailure(BASE);
    let released = false;
    void holdUntilBackendReady(BASE).then(() => (released = true));
    await vi.advanceTimersByTimeAsync(0);
    expect(isServerRestarting()).toBe(true);
    expect(released).toBe(false);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(released).toBe(true);
    expect(healthFetch).toHaveBeenCalledTimes(2);
  });
});
