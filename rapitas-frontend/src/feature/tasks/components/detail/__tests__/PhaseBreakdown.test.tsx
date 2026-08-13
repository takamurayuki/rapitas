/**
 * PhaseBreakdown
 *
 * role × 各回の実働内訳カード: 内訳なしでは何も描画しない、役割ラベル・
 * 回数・実働時間の表示、合計チップ、fetch 失敗時の非表示を検証する。
 */
import { render, screen, act } from '@testing-library/react';
import PhaseBreakdown, { formatDurationMs } from '../PhaseBreakdown';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, params?: Record<string, unknown>) =>
    params ? `${key}:${JSON.stringify(params)}` : key,
}));
vi.mock('@/utils/api', () => ({ API_BASE_URL: 'http://test:3001' }));

function jsonResponse(body: unknown) {
  return { ok: true, json: () => Promise.resolve(body) };
}

/** fetch → json → setState のマイクロタスクを流しきる。 */
async function flush() {
  await act(async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  });
}

describe('formatDurationMs', () => {
  it('1時間未満は M:SS、以降は H:MM:SS で整形する', () => {
    expect(formatDurationMs(5_000)).toBe('0:05');
    expect(formatDurationMs(10 * 60_000 + 30_000)).toBe('10:30');
    expect(formatDurationMs(2 * 3_600_000 + 5 * 60_000 + 9_000)).toBe('2:05:09');
    expect(formatDurationMs(-1)).toBe('0:00');
  });
});

describe('PhaseBreakdown', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('内訳が空なら何も描画しない', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse({ id: 1, activeTimeMs: 0, wallClockMs: 0, phaseBreakdown: [] }),
        ),
    );

    const { container } = render(<PhaseBreakdown taskId={1} />);
    await flush();

    expect(container.firstChild).toBeNull();
  });

  it('phaseBreakdown フィールドが無い（旧バックエンド）場合も何も描画しない', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ id: 1, title: 'x' })));

    const { container } = render(<PhaseBreakdown taskId={1} />);
    await flush();

    expect(container.firstChild).toBeNull();
  });

  it('役割ラベル・実行回数・実働時間・合計チップを表示する', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          id: 560,
          activeTimeMs: 45 * 60_000,
          wallClockMs: 50 * 60_000,
          phaseBreakdown: [
            { role: 'researcher', execCount: 1, activeTimeMs: 10 * 60_000 },
            { role: 'implementer', execCount: 3, activeTimeMs: 35 * 60_000 },
          ],
        }),
      ),
    );

    render(<PhaseBreakdown taskId={560} />);
    await flush();

    // 既知 role は i18n キーで描画（モックはキーを素通し）
    expect(
      screen.getByText('taskWorkflowSection.phaseBreakdown.role.researcher'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('taskWorkflowSection.phaseBreakdown.role.implementer'),
    ).toBeInTheDocument();
    // 回数チップ（修復再走を含む3回）
    expect(
      screen.getByText('taskWorkflowSection.phaseBreakdown.execCount:{"count":3}'),
    ).toBeInTheDocument();
    // 実働時間の表示
    expect(screen.getByText('10:00')).toBeInTheDocument();
    expect(screen.getByText('35:00')).toBeInTheDocument();
    // 合計チップ（実働合計 45分 / wall 50分）
    expect(
      screen.getByText('taskWorkflowSection.phaseBreakdown.totalActive:{"time":"45:00"}'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('taskWorkflowSection.phaseBreakdown.wallClock:{"time":"50:00"}'),
    ).toBeInTheDocument();
  });

  it('未知の role は生の文字列で描画する', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          id: 2,
          activeTimeMs: 60_000,
          wallClockMs: 60_000,
          phaseBreakdown: [{ role: 'single-run', execCount: 1, activeTimeMs: 60_000 }],
        }),
      ),
    );

    render(<PhaseBreakdown taskId={2} />);
    await flush();

    expect(screen.getByText('single-run')).toBeInTheDocument();
  });

  it('fetch 失敗時は何も描画しない（non-fatal）', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));

    const { container } = render(<PhaseBreakdown taskId={3} />);
    await flush();

    expect(container.firstChild).toBeNull();
  });
});
