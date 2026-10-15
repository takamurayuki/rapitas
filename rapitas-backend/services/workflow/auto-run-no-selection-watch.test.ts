/**
 * auto-run-no-selection-watch.test
 *
 * 2026-09-27: テーマが status=running / currentTaskId=null のまま 06:48〜11:03 の
 * 4 時間 15 分前進せず、どの検知器も報告しなかった(空回り検知は currentTaskId が
 * null だと判定を放棄する)。この状態を独立して測り、しきい値を超えたら 1 度だけ
 * 通知することを固定する。
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

const noopLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
mock.module('../../config/logger', () => ({
  createLogger: () => noopLogger,
  logger: noopLogger,
  getBackendLogFilePath: () => '/tmp/backend.log',
}));

let queuedCount = 0;
let currentTaskId: number | null = null;
let recentNotification: { id: number } | null = null;
/** The theme's own remaining tasks; one runnable task unless a test says otherwise. */
let themeTasks: unknown[] | null = [
  { status: 'todo', workflowStatus: 'draft', haltReason: null, autoRunExcluded: false },
];
const queueCountMock = mock(() => Promise.resolve(queuedCount));
const themeFindUniqueMock = mock(() => Promise.resolve({ currentTaskId }));
const notificationFindFirstMock = mock(() => Promise.resolve(recentNotification));
const taskFindManyMock = mock(() =>
  themeTasks ? Promise.resolve(themeTasks) : Promise.reject(new Error('DB unreadable')),
);

mock.module('../../config/database', () => ({
  prisma: {
    workflowQueueItem: { count: queueCountMock },
    themeAutoRun: { findUnique: themeFindUniqueMock },
    notification: { findFirst: notificationFindFirstMock },
    task: { findMany: taskFindManyMock },
  },
  ensureDatabaseConnection: () => Promise.resolve(),
}));

const createNotificationMock = mock(() => Promise.resolve({}));
mock.module('../communication/notification-service', () => ({
  createNotification: createNotificationMock,
}));

const logCycleEventMock = mock(() => {});
mock.module('../observability', () => ({
  logCycleEvent: logCycleEventMock,
  getCycleLogFilePath: () => '/tmp/cycle.ndjson',
}));

const hasLiveExecutionMock = mock(() => Promise.resolve(false));
mock.module('./auto-run/auto-run-selection', () => ({ hasLiveExecution: hasLiveExecutionMock }));

let waiters = { working: false, dispatchable: 0 };
const resolveQueuedWaitersMock = mock(() => Promise.resolve(waiters));
// NOTE: `() => true` would be a stub that contradicts the real rule, and
// auto-run-theme-parked depends on exactly these clauses. Mirror them.
const TERMINAL = ['done', 'completed', 'cancelled'];
mock.module('./queue-starvation-waiters', () => ({
  resolveQueuedWaiters: resolveQueuedWaitersMock,
  isDispatchableWaiter: (t: {
    status: string;
    workflowStatus: string | null;
    haltReason?: unknown;
  }) =>
    !TERMINAL.includes(t.status) &&
    !t.haltReason &&
    t.status !== 'blocked' &&
    t.workflowStatus !== 'awaiting_question' &&
    t.workflowStatus !== 'verify_done',
}));

const { checkNoSelectionProgress, resetNoSelectionTracker, NO_SELECTION_THRESHOLD_MS } =
  await import('./auto-run-no-selection-watch');

const NOW = 1_800_000_000_000;

beforeEach(() => {
  queuedCount = 0;
  currentTaskId = null;
  recentNotification = null;
  themeTasks = [
    { status: 'todo', workflowStatus: 'draft', haltReason: null, autoRunExcluded: false },
  ];
  waiters = { working: false, dispatchable: 0 };
  hasLiveExecutionMock.mockReset().mockResolvedValue(false);
  createNotificationMock.mockClear();
  logCycleEventMock.mockClear();
  notificationFindFirstMock.mockClear();
  resetNoSelectionTracker();
});

describe('checkNoSelectionProgress', () => {
  test('初回観測では報告しない(1 tick の継ぎ目を誤検出しない)', async () => {
    expect(await checkNoSelectionProgress(1, NOW)).toBe('armed');
    expect(createNotificationMock).not.toHaveBeenCalled();
  });

  test('しきい値未満の継続では報告しない', async () => {
    await checkNoSelectionProgress(1, NOW);
    expect(await checkNoSelectionProgress(1, NOW + NO_SELECTION_THRESHOLD_MS - 1_000)).toBe(
      'below-threshold',
    );
    expect(createNotificationMock).not.toHaveBeenCalled();
  });

  test('しきい値超過で cycle event と通知を出す(4 時間の無音を防ぐ)', async () => {
    await checkNoSelectionProgress(1, NOW);

    expect(await checkNoSelectionProgress(1, NOW + NO_SELECTION_THRESHOLD_MS + 1_000)).toBe(
      'reported',
    );
    expect(logCycleEventMock).toHaveBeenCalledWith(
      'theme.no_selection_progress',
      expect.objectContaining({ theme: 1, cause: 'running_without_selection' }),
    );
    expect(createNotificationMock).toHaveBeenCalled();
  });

  test.each([
    ['発行可能な待機項目がある', () => (waiters = { working: false, dispatchable: 1 })],
    ['エージェントが稼働中', () => (waiters = { working: true, dispatchable: 0 })],
  ])('進行中なら報告せずエピソードをリセットする: %s', async (_label, arrange) => {
    await checkNoSelectionProgress(1, NOW);
    arrange();

    expect(await checkNoSelectionProgress(1, NOW + NO_SELECTION_THRESHOLD_MS + 1_000)).toBe(
      'progressing',
    );
    // リセットされているので、次の観測は「初回」に戻る。
    waiters = { working: false, dispatchable: 0 };
    expect(await checkNoSelectionProgress(1, NOW + NO_SELECTION_THRESHOLD_MS + 2_000)).toBe(
      'armed',
    );
  });

  test('currentTaskId に生存エージェントがいれば待機として扱う', async () => {
    currentTaskId = 1106;
    hasLiveExecutionMock.mockResolvedValue(true);

    expect(await checkNoSelectionProgress(1, NOW)).toBe('progressing');
  });

  // 実測 2026-10-13: この誤報が本日の cycle ログ最多イベント（40件、19:35〜22:46、
  // 全てテーマ34）。そのときテーマ34 の残り6件は autoRunExcluded 5件と
  // awaiting_question 1件で、発行可能なものは無かった。系の不具合ではない。
  test('残り全件が保留なら「前進していない」ではなく park として報告する', async () => {
    themeTasks = [
      { status: 'todo', workflowStatus: 'draft', haltReason: null, autoRunExcluded: true },
      { status: 'in-progress', workflowStatus: 'awaiting_question', haltReason: null },
      { status: 'todo', workflowStatus: null, haltReason: null, autoRunExcluded: true },
    ];
    await checkNoSelectionProgress(34, NOW);

    expect(await checkNoSelectionProgress(34, NOW + NO_SELECTION_THRESHOLD_MS + 1_000)).toBe(
      'parked',
    );
    expect(logCycleEventMock).toHaveBeenCalledWith(
      'theme.parked_awaiting_human',
      expect.objectContaining({ theme: 34, cause: 'all_work_held_or_awaiting_answer', ok: true }),
    );
    // 誤った方の判定は出してはいけない。
    expect(logCycleEventMock).not.toHaveBeenCalledWith(
      'theme.no_selection_progress',
      expect.anything(),
    );
  });

  test('park の報告はエピソード中1回だけ（40件の繰り返しを止める）', async () => {
    themeTasks = [
      { status: 'todo', workflowStatus: 'draft', haltReason: null, autoRunExcluded: true },
    ];
    await checkNoSelectionProgress(34, NOW);
    for (let i = 1; i <= 5; i++) {
      expect(await checkNoSelectionProgress(34, NOW + NO_SELECTION_THRESHOLD_MS + i * 60_000)).toBe(
        'parked',
      );
    }
    expect(logCycleEventMock.mock.calls.length).toBe(1);
  });

  test('保留が解けて発行可能な仕事が戻れば、本来の停止判定に戻る', async () => {
    themeTasks = [
      { status: 'todo', workflowStatus: 'draft', haltReason: null, autoRunExcluded: true },
    ];
    await checkNoSelectionProgress(34, NOW);
    expect(await checkNoSelectionProgress(34, NOW + NO_SELECTION_THRESHOLD_MS + 1_000)).toBe(
      'parked',
    );

    themeTasks = [
      { status: 'todo', workflowStatus: 'draft', haltReason: null, autoRunExcluded: false },
    ];
    expect(await checkNoSelectionProgress(34, NOW + NO_SELECTION_THRESHOLD_MS + 2_000)).toBe(
      'reported',
    );
  });

  // 読めないことを park の証拠にすると、本物の停止を黙らせてしまう。
  test('タスクが読めない場合は従来どおり停止として報告する（fail toward reporting）', async () => {
    themeTasks = null;
    await checkNoSelectionProgress(1, NOW);

    expect(await checkNoSelectionProgress(1, NOW + NO_SELECTION_THRESHOLD_MS + 1_000)).toBe(
      'reported',
    );
  });

  test('同一ウィンドウ内では通知を重ねない', async () => {
    await checkNoSelectionProgress(1, NOW);
    recentNotification = { id: 9 };

    expect(await checkNoSelectionProgress(1, NOW + NO_SELECTION_THRESHOLD_MS + 1_000)).toBe(
      'reported',
    );
    expect(createNotificationMock).not.toHaveBeenCalled();
  });
});

describe('checkNoSelectionProgress — calendar-slot hold exemption (task 1174)', () => {
  test('カレンダー枠待ちで選定を保留中のテーマは停滞として報告しない', async () => {
    const { markCalendarHold, resetCalendarHoldState } =
      await import('../scheduling/calendar-slot/calendar-hold-state');
    resetCalendarHoldState();
    markCalendarHold(1, new Date(NOW + 2 * NO_SELECTION_THRESHOLD_MS));

    expect(await checkNoSelectionProgress(1, NOW)).toBe('progressing');
    expect(await checkNoSelectionProgress(1, NOW + NO_SELECTION_THRESHOLD_MS + 1_000)).toBe(
      'progressing',
    );
    expect(createNotificationMock).not.toHaveBeenCalled();
    resetCalendarHoldState();
  });

  test('保留の解除予定時刻を過ぎたマークは免除しない(永久免除にならない)', async () => {
    const { markCalendarHold, resetCalendarHoldState } =
      await import('../scheduling/calendar-slot/calendar-hold-state');
    resetCalendarHoldState();
    markCalendarHold(1, new Date(NOW - 1_000));

    expect(await checkNoSelectionProgress(1, NOW)).toBe('armed');
    resetCalendarHoldState();
  });
});
