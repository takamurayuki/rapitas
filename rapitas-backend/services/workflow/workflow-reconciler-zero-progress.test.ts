/**
 * workflow-reconciler-zero-progress.test
 *
 * Covers the task-653 zero-progress heal pass: a theme reporting
 * status='running' while its currentTaskId has ZERO AgentExecution rows must
 * fire only after the threshold persists, re-arm on taskId change or a
 * non-running interlude, and stay silent whenever an execution exists or the
 * count is unreadable (fail-open).
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';
import { ZERO_PROGRESS_THRESHOLD_MS } from './queue-stall-policy';

const noopLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

interface ThemeRow {
  themeId: number;
  currentTaskId: number | null;
  status: string;
}

const findByStatusesMock = mock(() => Promise.resolve([] as ThemeRow[]));
const countMock = mock(() => Promise.resolve(0));
const notifyZeroProgressWhileRunningMock = mock(() => Promise.resolve());
const logCycleEventMock = mock(() => {});

mock.module('../../config/logger', () => ({
  getBackendLogFilePath: () => '/tmp/backend.log',
  logger: noopLogger,
  createLogger: () => noopLogger,
}));
mock.module('../../config/database', () => ({
  prisma: { agentExecution: { count: countMock } },
  ensureDatabaseConnection: () => Promise.resolve(),
}));
mock.module('./auto-run/theme-auto-run-service', () => ({
  findByStatuses: findByStatusesMock,
}));
mock.module('./auto-run/auto-run-notifications', () => ({
  notifyZeroProgressWhileRunning: notifyZeroProgressWhileRunningMock,
}));
mock.module('../observability', () => ({
  logCycleEvent: logCycleEventMock,
  getCycleLogFilePath: () => '/tmp/cycle.ndjson',
}));

const { detectZeroProgressWhileRunning, resetZeroProgressTracker } =
  await import('./workflow-reconciler-zero-progress');

const NOW = 1_800_000_000_000;

/** running テーマ1件（themeId=1）を返すよう findByStatuses をセットする。 */
function primeRunningTheme(currentTaskId: number | null, themeId = 1): void {
  findByStatusesMock.mockResolvedValue([{ themeId, currentTaskId, status: 'running' }]);
}

beforeEach(() => {
  findByStatusesMock.mockReset().mockResolvedValue([]);
  countMock.mockReset().mockResolvedValue(0);
  notifyZeroProgressWhileRunningMock.mockReset().mockResolvedValue(undefined);
  logCycleEventMock.mockReset();
  resetZeroProgressTracker();
});

describe('detectZeroProgressWhileRunning', () => {
  test('currentTaskId=null のテーマは対象外 — 実行主体が無ければ計測もしない', async () => {
    primeRunningTheme(null);

    expect(await detectZeroProgressWhileRunning(NOW)).toBe(0);
    expect(countMock).not.toHaveBeenCalled();
    expect(notifyZeroProgressWhileRunningMock).not.toHaveBeenCalled();
  });

  test('初回観測は発火しない（アームのみ）', async () => {
    primeRunningTheme(100);

    expect(await detectZeroProgressWhileRunning(NOW)).toBe(0);
    expect(notifyZeroProgressWhileRunningMock).not.toHaveBeenCalled();
    expect(logCycleEventMock).not.toHaveBeenCalled();
  });

  test('閾値未満の継続では発火しない', async () => {
    primeRunningTheme(100);

    await detectZeroProgressWhileRunning(NOW);
    expect(await detectZeroProgressWhileRunning(NOW + ZERO_PROGRESS_THRESHOLD_MS - 1_000)).toBe(0);
    expect(notifyZeroProgressWhileRunningMock).not.toHaveBeenCalled();
  });

  test('閾値超過かつ AgentExecution 0件で発火する（task 653 再現シナリオ）', async () => {
    primeRunningTheme(100);
    countMock.mockResolvedValue(0);

    await detectZeroProgressWhileRunning(NOW);
    const detected = await detectZeroProgressWhileRunning(
      NOW + ZERO_PROGRESS_THRESHOLD_MS + 60_000,
    );

    expect(detected).toBe(1);
    expect(notifyZeroProgressWhileRunningMock).toHaveBeenCalledWith(1, 100, expect.any(Number));
    expect(logCycleEventMock).toHaveBeenCalledWith(
      'theme.zero_progress_detected',
      expect.objectContaining({ theme: 1, task: 100, ok: false }),
    );
    // The execution probe must scope to the current task via the relational where.
    const where = (countMock.mock.calls[0]?.[0] as { where: unknown } | undefined)?.where;
    expect(where).toEqual({ session: { config: { taskId: 100 } } });
  });

  test('閾値超過でも AgentExecution が1件以上あれば発火しない（正常な長時間フェーズ）', async () => {
    primeRunningTheme(100);
    countMock.mockResolvedValue(1);

    await detectZeroProgressWhileRunning(NOW);
    const detected = await detectZeroProgressWhileRunning(
      NOW + ZERO_PROGRESS_THRESHOLD_MS + 60_000,
    );

    expect(detected).toBe(0);
    expect(notifyZeroProgressWhileRunningMock).not.toHaveBeenCalled();
  });

  test('currentTaskId が変わると再アームされる — 旧タスクの経過時間を引き継がない', async () => {
    primeRunningTheme(100);
    countMock.mockResolvedValue(0);
    await detectZeroProgressWhileRunning(NOW);

    primeRunningTheme(200);
    const detected = await detectZeroProgressWhileRunning(
      NOW + ZERO_PROGRESS_THRESHOLD_MS + 60_000,
    );

    expect(detected).toBe(0);
    expect(notifyZeroProgressWhileRunningMock).not.toHaveBeenCalled();
  });

  test('テーマが running でなくなると追跡がクリアされ、復帰後は初回観測から数え直す', async () => {
    primeRunningTheme(100);
    countMock.mockResolvedValue(0);
    await detectZeroProgressWhileRunning(NOW);

    // 一時停止（running テーマなし）→ 追跡クリア
    findByStatusesMock.mockResolvedValue([]);
    await detectZeroProgressWhileRunning(NOW + 60_000);

    // 同テーマ・同タスクで running に復帰 — 一時停止前の経過時間を引き継がない
    primeRunningTheme(100);
    const detected = await detectZeroProgressWhileRunning(
      NOW + ZERO_PROGRESS_THRESHOLD_MS + 60_000,
    );

    expect(detected).toBe(0);
    expect(notifyZeroProgressWhileRunningMock).not.toHaveBeenCalled();
  });

  test('agentExecution.count 失敗時は安全側で発火しない（fail-open）', async () => {
    primeRunningTheme(100);
    countMock.mockRejectedValue(new Error('db down'));

    await detectZeroProgressWhileRunning(NOW);
    const detected = await detectZeroProgressWhileRunning(
      NOW + ZERO_PROGRESS_THRESHOLD_MS + 60_000,
    );

    expect(detected).toBe(0);
    expect(notifyZeroProgressWhileRunningMock).not.toHaveBeenCalled();
    expect(logCycleEventMock).not.toHaveBeenCalled();
  });

  test('findByStatuses は running のみを問い合わせる', async () => {
    await detectZeroProgressWhileRunning(NOW);

    expect(findByStatusesMock).toHaveBeenCalledWith(['running']);
  });
});
