/**
 * useTaskDetailData ユニットテスト
 *
 * task（ページヘッダー等に表示されるトップレベルのタスクオブジェクト）を
 * ワークフローがアクティブな間ポーリングし続けるという回帰テスト。
 * 以前は useWorkflowFiles 側の内部状態だけがポーリングされ、外部のエージェントが
 * ワークフローAPIを直接叩いて進めた場合など、このタスクオブジェクトは
 * 明示的なトリガー（実行完了・承認）でしか更新されず、手動リロードするまで
 * ステータス表示が古いままになっていた。
 */
import { renderHook, act } from '@testing-library/react';
import { useTaskDetailData } from '../useTaskDetailData';

// NOTE: the translator function must be a STABLE reference across renders —
// the hook's initial data-fetch effect depends on `t`, and real next-intl
// memoizes it. A fresh closure per call (as a naive inline mock would give)
// makes that effect re-fire every render in an infinite loop.
const mockT = (key: string) => key;
vi.mock('next-intl', () => ({
  useTranslations: () => mockT,
}));

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('@/lib/task-api', () => ({
  preloadTaskDetails: vi.fn(),
}));

vi.mock('@/lib/cache-warmup', () => ({
  recordTaskAccess: vi.fn(),
}));

const mockApiFetch = vi.fn();
const mockClearApiCache = vi.fn();
vi.mock('@/lib/api-client', () => ({
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
  clearApiCache: (...args: unknown[]) => mockClearApiCache(...args),
}));

function makeTask(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    title: 'Task',
    status: 'in-progress',
    workflowStatus: 'research_done',
    subtasks: [],
    ...overrides,
  };
}

describe('useTaskDetailData', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockApiFetch.mockReset();
    mockClearApiCache.mockReset();
    // Every non-task apiFetch call (time-entries/comments/resources/settings/
    // cli-availability) resolves to an empty/neutral value by default.
    mockApiFetch.mockImplementation((path: string) => {
      if (path.startsWith('/tasks/') && !path.includes('/')) return Promise.resolve(makeTask());
      if (path.match(/^\/tasks\/\d+$/)) return Promise.resolve(makeTask());
      return Promise.resolve([]);
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('polls the task while workflowStatus is active (e.g. research_done)', async () => {
    mockApiFetch.mockImplementation((path: string) =>
      Promise.resolve(
        path.match(/^\/tasks\/\d+$/) ? makeTask({ workflowStatus: 'research_done' }) : [],
      ),
    );

    renderHook(() => useTaskDetailData({ resolvedTaskId: '1' }));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    const callsAfterInitialLoad = mockApiFetch.mock.calls.filter((c) => c[0] === '/tasks/1').length;
    expect(callsAfterInitialLoad).toBeGreaterThanOrEqual(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    const callsAfterOnePoll = mockApiFetch.mock.calls.filter((c) => c[0] === '/tasks/1').length;
    expect(callsAfterOnePoll).toBeGreaterThan(callsAfterInitialLoad);
  });

  it('does not poll the task once workflowStatus is terminal (completed)', async () => {
    mockApiFetch.mockImplementation((path: string) =>
      Promise.resolve(
        path.match(/^\/tasks\/\d+$/) ? makeTask({ workflowStatus: 'completed' }) : [],
      ),
    );

    renderHook(() => useTaskDetailData({ resolvedTaskId: '1' }));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    const callsAfterInitialLoad = mockApiFetch.mock.calls.filter((c) => c[0] === '/tasks/1').length;

    await act(async () => {
      await vi.advanceTimersByTimeAsync(20000);
    });

    const callsAfterWait = mockApiFetch.mock.calls.filter((c) => c[0] === '/tasks/1').length;
    expect(callsAfterWait).toBe(callsAfterInitialLoad);
  });

  it('picks up a status change made outside this tab without a manual reload', async () => {
    let currentStatus = 'research_done';
    mockApiFetch.mockImplementation((path: string) =>
      Promise.resolve(
        path.match(/^\/tasks\/\d+$/) ? makeTask({ workflowStatus: currentStatus }) : [],
      ),
    );

    const { result } = renderHook(() => useTaskDetailData({ resolvedTaskId: '1' }));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.task?.workflowStatus).toBe('research_done');

    // Simulate an external agent advancing the workflow directly via the API
    // (bypassing this browser tab's own execute/approve handlers).
    currentStatus = 'plan_created';

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    expect(result.current.task?.workflowStatus).toBe('plan_created');
  });
});
