/**
 * task-cache-store outage logging tests
 *
 * One backend outage must produce one warning, not a stream of errors.
 */
const log = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({ createLogger: () => log }));

vi.mock('@/utils/api', () => ({
  API_BASE_URL: 'http://test:3001',
  buildApiUrl: (p: string) => 'http://test:3001' + p,
  fetchWithRetry: vi.fn(),
}));

import { useTaskCacheStore } from '../task-cache-store';
import { fetchWithRetry } from '@/utils/api';

const TIMEOUT = new Error(
  'Failed to fetch from http://test:3001/tasks?since=x after 3 attempts. signal is aborted without reason',
);

function okIncremental(): Response {
  return {
    ok: true,
    json: () => Promise.resolve({ incremental: true, tasks: [], totalCount: 1, activeIds: [1] }),
  } as unknown as Response;
}

/** Messages logged at a level whose text mentions fetchUpdates. */
function fetchUpdatesLogs(fn: ReturnType<typeof vi.fn>): unknown[][] {
  return fn.mock.calls.filter((c) => String(c[0]).includes('fetchUpdates'));
}

// 2026-11-22: while the SSE streams were reconnecting every minute, the
// browser queued plain fetches past their timeout, and every app window logged
// "[taskCacheStore] fetchUpdates error" at ERROR level three times per outage —
// and again after each brief recovery.
describe('taskCacheStore fetchUpdates — outage logging', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useTaskCacheStore.setState({
      tasks: [{ id: 1, title: 'Task' } as never],
      lastFetchedAt: new Date().toISOString(),
      loading: false,
      initialized: true,
      connectionStatus: 'online',
      consecutiveFailures: 0,
      lastError: null,
    });
  });

  it('logs an outage once, as a warning, however many polls fail', async () => {
    vi.mocked(fetchWithRetry).mockRejectedValue(TIMEOUT);
    for (let i = 0; i < 6; i++) await useTaskCacheStore.getState().fetchUpdates(true);

    expect(fetchUpdatesLogs(log.error)).toHaveLength(0);
    expect(fetchUpdatesLogs(log.warn)).toHaveLength(1);
    expect(useTaskCacheStore.getState().consecutiveFailures).toBe(6);
  });

  it('logs one recovery line, then a new outage gets its own single warning', async () => {
    vi.mocked(fetchWithRetry).mockRejectedValueOnce(TIMEOUT).mockRejectedValueOnce(TIMEOUT);
    await useTaskCacheStore.getState().fetchUpdates(true);
    await useTaskCacheStore.getState().fetchUpdates(true);

    vi.mocked(fetchWithRetry).mockResolvedValueOnce(okIncremental());
    await useTaskCacheStore.getState().fetchUpdates(true);
    expect(fetchUpdatesLogs(log.info)).toHaveLength(1);

    vi.mocked(fetchWithRetry).mockRejectedValueOnce(TIMEOUT).mockRejectedValueOnce(TIMEOUT);
    await useTaskCacheStore.getState().fetchUpdates(true);
    await useTaskCacheStore.getState().fetchUpdates(true);

    expect(fetchUpdatesLogs(log.error)).toHaveLength(0);
    expect(fetchUpdatesLogs(log.warn)).toHaveLength(2);
  });
});
