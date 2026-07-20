/**
 * useDeveloperMode — 実行状態の再検知ポーリング ユニットテスト
 *
 * マウント時の一度きりの自動復元だけでは、タスク詳細ページを開いたまま
 * 外部（自動実行・別タブ・ワークフローAPI直叩き）から新しい実行が開始された
 * 場合に検知できず、直前の完了パネル（緑背景）が固まったまま残ってしまう。
 * isExecuting が false の間、execution-status を定期的に再チェックし続ける
 * ことを検証する回帰テスト。
 */
import { renderHook, act } from '@testing-library/react';
import { useDeveloperMode } from '../useDeveloperMode';

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

const mockFetch = vi.fn();

function jsonResponse(body: unknown) {
  return Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
}

describe('useDeveloperMode execution-status polling', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockFetch.mockReset();
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('detects a NEW execution starting after the initial completed restore, without a reload', async () => {
    let executionStatus = 'completed';
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('/execution-status')) {
        return jsonResponse({
          executionStatus,
          status: 'has-history',
          sessionId: 1,
          executionId: 1,
          output: 'done',
        });
      }
      return jsonResponse({});
    });

    const { result } = renderHook(() => useDeveloperMode(1));

    // Initial one-shot auto-restore on mount picks up the completed state.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.isRestoringState).toBe(false);
    expect(result.current.isExecuting).toBe(false);
    expect(result.current.executionStatus).toBe('completed');

    // An external agent starts a NEW run directly via the backend — this tab
    // never called executeAgent, so nothing else would ever notice.
    executionStatus = 'running';

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    expect(result.current.isExecuting).toBe(true);
    expect(result.current.executionStatus).toBe('running');
  });

  it('does not poll while an execution is already being tracked as running', async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('/execution-status')) {
        return jsonResponse({ executionStatus: 'running', status: 'ok', sessionId: 1 });
      }
      return jsonResponse({});
    });

    renderHook(() => useDeveloperMode(1));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    const callsAfterMount = mockFetch.mock.calls.filter((c) =>
      String(c[0]).includes('/execution-status'),
    ).length;
    expect(callsAfterMount).toBe(1);

    // While isExecuting is true, the periodic re-check must NOT fire — the
    // live session polling elsewhere owns tracking from here.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15000);
    });
    const callsAfterWait = mockFetch.mock.calls.filter((c) =>
      String(c[0]).includes('/execution-status'),
    ).length;
    expect(callsAfterWait).toBe(callsAfterMount);
  });
});
