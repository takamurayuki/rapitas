/**
 * task-cache-store full-fetch de-duplication
 *
 * GET /tasks returns the whole list — measured 2026-10-06: 650 tasks, 3.18 MB,
 * 1.76 s on an idle backend. Nothing stopped several callers from each starting
 * their own copy, and overlapping copies turned that slow endpoint into an
 * outage (16 concurrent connections, the WebView2 network service at ~700 MB and
 * 36% of a core, Prisma transactions past their 5 s budget).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/utils/logger', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

/** Resolver for the pending fetch, so the test controls when it completes. */
let releaseFetch: ((body: unknown) => void) | undefined;
let fetchCalls = 0;

vi.mock('@/utils/api', () => ({
  API_BASE_URL: 'http://127.0.0.1:3001',
  fetchWithRetry: vi.fn(() => {
    fetchCalls += 1;
    return new Promise((resolve) => {
      releaseFetch = (body: unknown) =>
        resolve({ ok: true, json: () => Promise.resolve(body) } as Response);
    });
  }),
}));

const freshStore = async () => {
  vi.resetModules();
  (globalThis as unknown as { __rapitasTaskFullFetch?: unknown }).__rapitasTaskFullFetch = null;
  const mod = await import('../task-cache-store');
  return mod.useTaskCacheStore;
};

beforeEach(() => {
  fetchCalls = 0;
  releaseFetch = undefined;
});

afterEach(() => {
  (globalThis as unknown as { __rapitasTaskFullFetch?: unknown }).__rapitasTaskFullFetch = null;
});

describe('task-cache-store: 全件取得の多重実行防止', () => {
  it('同時に3回呼ばれても GET /tasks は1回しか飛ばない', async () => {
    const useStore = await freshStore();

    const a = useStore.getState().fetchAll();
    const b = useStore.getState().fetchAll();
    const c = useStore.getState().fetchAll();

    expect(fetchCalls).toBe(1);

    releaseFetch?.([{ id: 1, status: 'todo' }]);
    await Promise.all([a, b, c]);

    // 3 callers, one request, and every caller still gets the result.
    expect(fetchCalls).toBe(1);
    expect(useStore.getState().tasks).toHaveLength(1);
    expect(useStore.getState().initialized).toBe(true);
  });

  it('完了後は次の取得が通る（恒久的に塞がない）', async () => {
    const useStore = await freshStore();

    const first = useStore.getState().fetchAll();
    releaseFetch?.([{ id: 1, status: 'todo' }]);
    await first;
    expect(fetchCalls).toBe(1);

    // initialized + lastFetchedAt is now set, so fetchAll delegates to the
    // incremental path; performFullFetch is reached again via fetchUpdates'
    // no-baseline branch only. Reset the baseline to exercise the full path.
    useStore.setState({ lastFetchedAt: null, initialized: false });
    const second = useStore.getState().fetchAll();
    expect(fetchCalls).toBe(2);
    releaseFetch?.([{ id: 2, status: 'todo' }]);
    await second;
  });

  it('失敗しても解放され、次の取得を塞がない', async () => {
    vi.resetModules();
    (globalThis as unknown as { __rapitasTaskFullFetch?: unknown }).__rapitasTaskFullFetch = null;
    vi.doMock('@/utils/api', () => ({
      API_BASE_URL: 'http://127.0.0.1:3001',
      fetchWithRetry: vi.fn(() => {
        fetchCalls += 1;
        return Promise.reject(new Error('network down'));
      }),
    }));
    const { useTaskCacheStore } = await import('../task-cache-store');

    await useTaskCacheStore.getState().fetchAll();
    expect(
      (globalThis as unknown as { __rapitasTaskFullFetch?: unknown }).__rapitasTaskFullFetch,
    ).toBeNull();

    useTaskCacheStore.setState({ lastFetchedAt: null, initialized: false });
    await useTaskCacheStore.getState().fetchAll();
    expect(fetchCalls).toBe(2);
    vi.doUnmock('@/utils/api');
  });
});
