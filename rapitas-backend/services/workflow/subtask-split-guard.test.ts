/**
 * subtask-split-guard テスト
 *
 * フラグ無効時に research_done 親の下へ子タスクが作成された場合のみ
 * log.warn + 通知が発火し、それ以外（フラグ有効・親が別状態・parentId 無し・
 * DBエラー）では何も起きないことを検証。
 */
import { describe, test, expect, beforeEach, afterAll, mock } from 'bun:test';

const findUniqueMock = mock(() => Promise.resolve<unknown>(null));
const createNotificationMock = mock(() => Promise.resolve({}));
const warnMock = mock(() => {});

mock.module('../../config/database', () => ({
  prisma: { task: { findUnique: findUniqueMock } },
  ensureDatabaseConnection: () => Promise.resolve(),
}));
mock.module('../../config/logger', () => {
  const noop = { info: () => {}, error: () => {}, warn: warnMock, debug: () => {} };
  return {
    createLogger: () => noop,
    logger: noop,
    getBackendLogFilePath: () => '/tmp/backend.log',
  };
});
mock.module('../communication/notification-service', () => ({
  createNotification: createNotificationMock,
}));

const { warnIfSubtaskCreatedDuringDisabledSplit } = await import('./subtask-split-guard');

const CHILD = { id: 999, parentId: 545, title: '子タスク' };
const ORIGINAL_ENV = process.env.RAPITAS_ENABLE_SUBTASK_SPLIT;

beforeEach(() => {
  delete process.env.RAPITAS_ENABLE_SUBTASK_SPLIT;
  findUniqueMock.mockReset();
  createNotificationMock.mockReset();
  createNotificationMock.mockResolvedValue({});
  warnMock.mockReset();
});

afterAll(() => {
  if (ORIGINAL_ENV === undefined) {
    delete process.env.RAPITAS_ENABLE_SUBTASK_SPLIT;
  } else {
    process.env.RAPITAS_ENABLE_SUBTASK_SPLIT = ORIGINAL_ENV;
  }
});

describe('warnIfSubtaskCreatedDuringDisabledSplit', () => {
  test('フラグ有効時は親の照会すらせず何もしない', async () => {
    process.env.RAPITAS_ENABLE_SUBTASK_SPLIT = '1';
    await warnIfSubtaskCreatedDuringDisabledSplit(CHILD);
    expect(findUniqueMock).not.toHaveBeenCalled();
    expect(createNotificationMock).not.toHaveBeenCalled();
    expect(warnMock).not.toHaveBeenCalled();
  });

  test('parentId が無ければ何もしない', async () => {
    await warnIfSubtaskCreatedDuringDisabledSplit({ id: 1, parentId: null, title: 'T' });
    expect(findUniqueMock).not.toHaveBeenCalled();
    expect(createNotificationMock).not.toHaveBeenCalled();
  });

  test('フラグ無効 + 親が research_done 以外なら警告しない', async () => {
    findUniqueMock.mockResolvedValueOnce({ workflowStatus: 'plan_approved', title: '親' });
    await warnIfSubtaskCreatedDuringDisabledSplit(CHILD);
    expect(findUniqueMock).toHaveBeenCalledTimes(1);
    expect(createNotificationMock).not.toHaveBeenCalled();
    expect(warnMock).not.toHaveBeenCalled();
  });

  test('フラグ無効 + 親が research_done なら log.warn + 通知を発行する', async () => {
    findUniqueMock.mockResolvedValueOnce({ workflowStatus: 'research_done', title: '親タスク' });
    await warnIfSubtaskCreatedDuringDisabledSplit(CHILD);
    expect(warnMock).toHaveBeenCalledTimes(1);
    expect(createNotificationMock).toHaveBeenCalledTimes(1);
    const arg = createNotificationMock.mock.calls[0][0] as unknown as {
      type: string;
      title: string;
      link: string;
      metadata: { parentId: number; newTaskId: number };
    };
    expect(arg.type).toBe('system');
    expect(arg.title).toContain('サブタスク分割が無効');
    expect(arg.link).toBe('/tasks/545');
    expect(arg.metadata).toEqual({ parentId: 545, newTaskId: 999 });
  });

  test('親タスクの照会が失敗しても例外を投げず静かに終了する', async () => {
    findUniqueMock.mockRejectedValueOnce(new Error('db down'));
    await warnIfSubtaskCreatedDuringDisabledSplit(CHILD);
    expect(createNotificationMock).not.toHaveBeenCalled();
  });

  test('通知作成が失敗しても例外を投げない（log.warn は発火済み）', async () => {
    findUniqueMock.mockResolvedValueOnce({ workflowStatus: 'research_done', title: '親' });
    createNotificationMock.mockRejectedValueOnce(new Error('notify down'));
    await warnIfSubtaskCreatedDuringDisabledSplit(CHILD);
    expect(warnMock).toHaveBeenCalledTimes(1);
  });
});
