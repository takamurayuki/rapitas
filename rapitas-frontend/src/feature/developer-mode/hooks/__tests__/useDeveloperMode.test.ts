/**
 * useDeveloperMode.test.ts
 *
 * サイドパネル（タスク詳細）を開いたときの `restoreExecutionState` が、
 * ホーム一覧と共有する execution-state-store の `startedAt` を欠落させず
 * 保持することを検証する（#494: サイドパネル展開で実行時間バッジが消える）。
 */
import { renderHook, act, waitFor } from '@testing-library/react';
import { useDeveloperMode } from '../useDeveloperMode';
import { useExecutionStateStore } from '@/stores/execution-state-store';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock('@/utils/api', () => ({ API_BASE_URL: 'http://test:3001' }));

const STARTED_AT = '2026-07-17T00:00:00.000Z';

function mockStatusResponse(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    json: () =>
      Promise.resolve({
        executionStatus: 'running',
        status: 'active',
        sessionId: 10,
        startedAt: STARTED_AT,
        output: '',
        ...overrides,
      }),
  };
}

describe('useDeveloperMode - restoreExecutionState startedAt propagation', () => {
  beforeEach(() => {
    useExecutionStateStore.setState({ executingTasks: new Map() });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('propagates startedAt from the execution-status response into the shared store', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockStatusResponse()));

    renderHook(() => useDeveloperMode(1));

    await waitFor(() => {
      expect(useExecutionStateStore.getState().getExecutingTaskStartedAt(1)).toBe(STARTED_AT);
    });
  });

  it('does not clear a startedAt already present from list polling when the panel mounts', async () => {
    // Simulate the home list's poller having already populated the store
    // (this is the exact sequence that reproduced the bug: list shows the
    // elapsed-time badge, then the user opens the side panel for the same task).
    act(() => {
      useExecutionStateStore.getState().setExecutingTask({
        taskId: 2,
        sessionId: 10,
        status: 'running',
        startedAt: STARTED_AT,
      });
    });

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockStatusResponse({ sessionId: 10 })));

    const { result } = renderHook(() => useDeveloperMode(2));

    // Wait for restoreExecutionState's mount effect to actually finish before
    // asserting — otherwise this check could pass trivially against the
    // pre-existing store value before the (buggy) overwrite has run.
    await waitFor(() => {
      expect(result.current.isRestoringState).toBe(false);
    });

    expect(useExecutionStateStore.getState().getExecutingTaskStartedAt(2)).toBe(STARTED_AT);
  });

  it('preserves startedAt for the waiting_for_input status too', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(mockStatusResponse({ executionStatus: 'waiting_for_input' })),
    );

    renderHook(() => useDeveloperMode(3));

    await waitFor(() => {
      expect(useExecutionStateStore.getState().getExecutingTaskStartedAt(3)).toBe(STARTED_AT);
    });
  });
});

describe('useDeveloperMode - restoreExecutionState executionResult.success', () => {
  beforeEach(() => {
    useExecutionStateStore.setState({ executingTasks: new Map() });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Regression: an interrupted execution (server restart / crash mid-run) used
  // to compute `success: statusData.executionStatus !== 'failed'`, which is
  // `true` for 'interrupted' — reopening the task detail page then showed it
  // as a completed run. Only 'completed'/'failed' are real terminal verdicts;
  // 'interrupted' (and 'running'/'waiting_for_input') must leave `success`
  // undefined so downstream `isRestoredTerminal` checks don't fire.
  it.each([
    { executionStatus: 'interrupted', expected: undefined },
    { executionStatus: 'running', expected: undefined },
    { executionStatus: 'waiting_for_input', expected: undefined },
    { executionStatus: 'completed', expected: true },
    { executionStatus: 'failed', expected: false },
  ])(
    'sets executionResult.success to $expected for executionStatus=$executionStatus',
    async ({ executionStatus, expected }) => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockStatusResponse({ executionStatus })));

      const { result } = renderHook(() => useDeveloperMode(100));

      await waitFor(() => {
        expect(result.current.isRestoringState).toBe(false);
      });

      expect(result.current.executionResult?.success).toBe(expected);
    },
  );
});
