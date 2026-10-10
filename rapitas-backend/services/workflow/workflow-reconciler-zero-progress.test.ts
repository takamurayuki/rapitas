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

const warnMock = mock((..._args: unknown[]) => {});
const noopLogger = { info: () => {}, warn: warnMock, error: () => {}, debug: () => {} };

interface ThemeRow {
  themeId: number;
  currentTaskId: number | null;
  status: string;
}

const findByStatusesMock = mock(() => Promise.resolve([] as ThemeRow[]));
const countMock = mock(() => Promise.resolve(0));
const findFirstMock = mock(() =>
  Promise.resolve(null as { createdAt: Date; status: string } | null),
);
const taskFindUniqueMock = mock(() =>
  Promise.resolve(null as { status: string; workflowStatus: string | null } | null),
);
const notifyZeroProgressWhileRunningMock = mock(() => Promise.resolve());
const logCycleEventMock = mock(() => {});

mock.module('../../config/logger', () => ({
  getBackendLogFilePath: () => '/tmp/backend.log',
  logger: noopLogger,
  createLogger: () => noopLogger,
}));
mock.module('../../config/database', () => ({
  prisma: {
    agentExecution: { count: countMock, findFirst: findFirstMock },
    task: { findUnique: taskFindUniqueMock },
  },
  ensureDatabaseConnection: () => Promise.resolve(),
}));
mock.module('./auto-run/theme-auto-run-service', () => ({
  findByStatuses: findByStatusesMock,
}));
let queuedBehind = false;
mock.module('./auto-run/queue-wait-exemption', () => ({
  liveOrQueuedBehind: () => Promise.resolve(queuedBehind),
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
// The real guard, not a mock: mock.module is process-global and replacing the
// guard here would break its own test file in the same run.
const { guardImplementOverlap, resetOverlapGuardState } =
  await import('./workflow-orchestrator-overlap-guard');

const NOW = 1_800_000_000_000;
const HOLD_CEILING_MS = 30 * 60 * 1000;

/** Put a real overlap hold on the task, started at `startedAt`. */
async function holdOverlap(taskId: number, startedAt: number): Promise<void> {
  const outcome = await guardImplementOverlap(
    taskId,
    { role: 'implementer', outputFile: null, nextStatus: 'in_progress' },
    { themeId: 1, theme: { workingDirectory: 'C:/repo' } },
    'plan_approved',
    {
      openPrs: async () => [
        { prNumber: 829, linkedTaskId: 999, createdAt: new Date(startedAt - 60_000) },
      ],
      prFiles: async () => ['a.ts'],
      artifact: async () => '対象: `a.ts`',
      parseFiles: () => ['a.ts'],
      overlap: async () => ['a.ts'],
      isParked: async () => false,
      isHalted: async () => false,
      ownPr: async () => null,
      now: () => startedAt,
    },
  );
  expect(outcome.done).toBe(true);
}

/** running テーマ1件（themeId=1）を返すよう findByStatuses をセットする。 */
function primeRunningTheme(currentTaskId: number | null, themeId = 1): void {
  findByStatusesMock.mockResolvedValue([{ themeId, currentTaskId, status: 'running' }]);
}

beforeEach(() => {
  findByStatusesMock.mockReset().mockResolvedValue([]);
  countMock.mockReset().mockResolvedValue(0);
  findFirstMock.mockReset().mockResolvedValue(null);
  taskFindUniqueMock.mockReset().mockResolvedValue(null);
  warnMock.mockReset();
  notifyZeroProgressWhileRunningMock.mockReset().mockResolvedValue(undefined);
  logCycleEventMock.mockReset();
  resetZeroProgressTracker();
  resetOverlapGuardState();
});

describe('detectZeroProgressWhileRunning', () => {
  // 2026-10-08: 143 false alarms — tasks past verify (PR open, waiting on CI /
  // auto-merge) run no agent by design, so "no executions" is not a spin.
  test.each([['verify_done'], ['completed']])(
    'workflowStatus=%s のタスクは警報を出さず静かな cycle event にする',
    async (workflowStatus) => {
      primeRunningTheme(1145);
      taskFindUniqueMock.mockResolvedValue({ status: 'in_progress', workflowStatus });

      await detectZeroProgressWhileRunning(NOW);
      expect(await detectZeroProgressWhileRunning(NOW + ZERO_PROGRESS_THRESHOLD_MS)).toBe(0);
      expect(warnMock).not.toHaveBeenCalled();
      expect(notifyZeroProgressWhileRunningMock).not.toHaveBeenCalled();
      expect(logCycleEventMock).toHaveBeenCalledWith(
        'theme.waiting_for_merge',
        expect.objectContaining({ task: 1145, ok: true }),
      );
    },
  );

  test('workflowStatus=in_progress で実行ゼロなら従来どおり検出する', async () => {
    primeRunningTheme(905);
    taskFindUniqueMock.mockResolvedValue({ status: 'in_progress', workflowStatus: 'in_progress' });

    await detectZeroProgressWhileRunning(NOW);
    expect(await detectZeroProgressWhileRunning(NOW + ZERO_PROGRESS_THRESHOLD_MS)).toBe(1);
    expect(warnMock).toHaveBeenCalledTimes(1);
  });

  test('タスク状態を読めない場合は免除せず警報に倒す', async () => {
    primeRunningTheme(905);
    taskFindUniqueMock.mockRejectedValue(new Error('db down'));

    await detectZeroProgressWhileRunning(NOW);
    expect(await detectZeroProgressWhileRunning(NOW + ZERO_PROGRESS_THRESHOLD_MS)).toBe(1);
  });

  // 2026-10-06 20:18Z: the alarm fired with only {themeId, taskId, elapsedMinutes}, so
  // "never ran" could not be told apart from "ran, then stopped" (e.g. a worktree reclaim).
  test('警報ログに直近の実行の有無・時刻・状態を含める', async () => {
    primeRunningTheme(1147);
    const lastAt = new Date(NOW - 3_600_000);
    findFirstMock.mockResolvedValue({ createdAt: lastAt, status: 'cancelled' });

    await detectZeroProgressWhileRunning(NOW);
    expect(await detectZeroProgressWhileRunning(NOW + ZERO_PROGRESS_THRESHOLD_MS)).toBe(1);
    expect(warnMock).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: 1147,
        lastExecutionAt: lastAt.toISOString(),
        lastExecutionStatus: 'cancelled',
      }),
      '[reconciler] Zero-progress spin detected — theme running with no executions',
    );
  });

  test('実行履歴が一度も無ければ lastExecutionAt は null', async () => {
    primeRunningTheme(1147);

    await detectZeroProgressWhileRunning(NOW);
    await detectZeroProgressWhileRunning(NOW + ZERO_PROGRESS_THRESHOLD_MS);
    expect(warnMock).toHaveBeenCalledWith(
      expect.objectContaining({ lastExecutionAt: null, lastExecutionStatus: null }),
      expect.any(String),
    );
  });

  // 2026-09-27: currentTaskId=null を「計測対象外」として捨てていたため、
  // status=running / 選定なしのまま 4 時間 15 分前進しない状態を誰も報告できなかった。
  // このパスでは実行数を数えず(実行主体が無いので意味がない)、その状態専用の
  // ウォッチへ委譲する。
  test('currentTaskId=null は実行数を数えず no-selection ウォッチへ委譲する', async () => {
    primeRunningTheme(null);

    expect(await detectZeroProgressWhileRunning(NOW)).toBe(0);
    expect(countMock).not.toHaveBeenCalled();
    expect(notifyZeroProgressWhileRunningMock).not.toHaveBeenCalled();
  });

  // 2026-09-27 15:00-15:15Z, task 1111: 重複ガードが実装フェーズを 30 分保留する間、
  // この検知器は 17 回警報を出した。保留は設計どおりの待機であって空回りではない。
  test('重複保留が上限内なら警報せず静かなイベントに落とす（1111 の 17 連打事例）', async () => {
    primeRunningTheme(1111);
    await holdOverlap(1111, NOW);

    await detectZeroProgressWhileRunning(NOW);
    expect(await detectZeroProgressWhileRunning(NOW + ZERO_PROGRESS_THRESHOLD_MS)).toBe(0);
    expect(notifyZeroProgressWhileRunningMock).not.toHaveBeenCalled();
    expect(logCycleEventMock).toHaveBeenCalledWith(
      'theme.waiting_for_overlap_hold',
      expect.objectContaining({ task: 1111, holdMs: ZERO_PROGRESS_THRESHOLD_MS }),
    );
  });

  // 上限を超えた保留は本検知器が存在する理由そのもの（905/914/937）なので警報は残す。
  test('重複保留が上限を超えていれば従来どおり警報する', async () => {
    primeRunningTheme(1111);
    await holdOverlap(1111, NOW - HOLD_CEILING_MS - 60_000);

    await detectZeroProgressWhileRunning(NOW);
    expect(await detectZeroProgressWhileRunning(NOW + ZERO_PROGRESS_THRESHOLD_MS)).toBe(1);
    expect(notifyZeroProgressWhileRunningMock).toHaveBeenCalledTimes(1);
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
    // The execution probe must scope to the current task AND to executions
    // created since the episode's anchor — not a lifetime count (2026-09-17
    // fix: a lifetime count is >0 forever after the task's first phase).
    const where = (
      countMock.mock.calls[0]?.[0] as
        | {
            where: {
              session: unknown;
              OR: Array<Record<string, { gte: Date }>>;
            };
          }
        | undefined
    )?.where;
    expect(where?.session).toEqual({ config: { taskId: 100 } });
    // Task 1031 (2026-09-22): a 19-minute implementer run created BEFORE the
    // slid anchor was still heartbeating and got counted as zero. Any row
    // created, heartbeating, or completed after the anchor is progress.
    expect(where?.OR.map((c) => Object.keys(c)[0])).toEqual([
      'createdAt',
      'heartbeatAt',
      'completedAt',
    ]);
    for (const clause of where?.OR ?? []) {
      expect(Object.values(clause)[0]?.gte).toBeInstanceOf(Date);
    }
  });

  test('進捗後は次フェーズで再度ゼロ件が続けば検出する — アンカーが前進する（2026-09-17 修正: lifetime countの見落とし回帰）', async () => {
    primeRunningTheme(100);
    // Episode 1: no execution yet, first observation arms the tracker.
    countMock.mockResolvedValue(0);
    await detectZeroProgressWhileRunning(NOW);

    // A real execution lands inside the window — must NOT fire, and must
    // slide the anchor forward to this observation instead of staying at NOW.
    countMock.mockResolvedValue(1);
    const midCycle = NOW + ZERO_PROGRESS_THRESHOLD_MS + 60_000;
    expect(await detectZeroProgressWhileRunning(midCycle)).toBe(0);
    expect(notifyZeroProgressWhileRunningMock).not.toHaveBeenCalled();

    // The SAME task (still current — e.g. now in a later phase) then stalls
    // again with zero NEW executions. A lifetime-count detector could never
    // catch this (count is already >0 forever); the anchor-scoped count must.
    countMock.mockResolvedValue(0);
    const detected = await detectZeroProgressWhileRunning(
      midCycle + ZERO_PROGRESS_THRESHOLD_MS + 60_000,
    );
    expect(detected).toBe(1);
    expect(notifyZeroProgressWhileRunningMock).toHaveBeenCalledWith(1, 100, expect.any(Number));
    // The scoped count's lower bound must be the SLID anchor (midCycle), not
    // the original first-observation time (NOW).
    const lastWhere = (
      countMock.mock.calls.at(-1)?.[0] as
        | { where: { OR: Array<{ createdAt?: { gte: Date }; heartbeatAt?: { gte: Date } }> } }
        | undefined
    )?.where;
    expect(lastWhere?.OR[0]?.createdAt?.gte.getTime()).toBe(midCycle);
    expect(lastWhere?.OR[1]?.heartbeatAt?.gte.getTime()).toBe(midCycle);
  });

  test('閾値超過・実行0件でも、他タスクが枠を占有していれば発火しない（#856 事例）', async () => {
    queuedBehind = true;
    try {
      countMock.mockResolvedValue(0);
      const t0 = 1_000_000;
      await detectZeroProgressWhileRunning(t0);
      const detected = await detectZeroProgressWhileRunning(t0 + ZERO_PROGRESS_THRESHOLD_MS + 1);
      expect(detected).toBe(0);
    } finally {
      queuedBehind = false;
    }
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
