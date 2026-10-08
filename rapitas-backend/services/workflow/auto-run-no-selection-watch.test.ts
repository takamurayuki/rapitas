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
const queueCountMock = mock(() => Promise.resolve(queuedCount));
const themeFindUniqueMock = mock(() => Promise.resolve({ currentTaskId }));
const notificationFindFirstMock = mock(() => Promise.resolve(recentNotification));

mock.module('../../config/database', () => ({
  prisma: {
    workflowQueueItem: { count: queueCountMock },
    themeAutoRun: { findUnique: themeFindUniqueMock },
    notification: { findFirst: notificationFindFirstMock },
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
mock.module('./queue-starvation-waiters', () => ({
  resolveQueuedWaiters: resolveQueuedWaitersMock,
  isDispatchableWaiter: () => true,
}));

const { checkNoSelectionProgress, resetNoSelectionTracker, NO_SELECTION_THRESHOLD_MS } =
  await import('./auto-run-no-selection-watch');

const NOW = 1_800_000_000_000;

beforeEach(() => {
  queuedCount = 0;
  currentTaskId = null;
  recentNotification = null;
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

  test('同一ウィンドウ内では通知を重ねない', async () => {
    await checkNoSelectionProgress(1, NOW);
    recentNotification = { id: 9 };

    expect(await checkNoSelectionProgress(1, NOW + NO_SELECTION_THRESHOLD_MS + 1_000)).toBe(
      'reported',
    );
    expect(createNotificationMock).not.toHaveBeenCalled();
  });
});
