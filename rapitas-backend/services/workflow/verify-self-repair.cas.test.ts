/**
 * verify-self-repair.cas.test
 *
 * attemptVerifyRepair の compare-and-swap 検証: 評価時点の workflowStatus から
 * タスクが先へ進んでいた場合（遅延 verdict — task 551 で completed 済みタスクが
 * plan_approved へ巻き戻された事故）に、rollback もフィードバック書込も行わず
 * `stale:true` を返すこと。純関数テスト（verify-self-repair.test.ts）とは
 * mock.module 汚染を避けるため別ファイル。
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

const noopLogger = { info: () => {}, warn: mock(() => {}), error: () => {}, debug: () => {} };

const mockPrisma = {
  userSettings: { findFirst: mock(() => Promise.resolve(null)) },
  activityLog: { findFirst: mock(() => Promise.resolve(null)) },
  workflowTransition: {
    count: mock(() => Promise.resolve(0)),
    findFirst: mock(() => Promise.resolve(null)),
  },
  task: {
    updateMany: mock(() => Promise.resolve({ count: 1 })),
    findFirst: mock(() => Promise.resolve(null)),
    findUnique: mock(() => Promise.resolve(null)),
  },
  workflowFile: { findFirst: mock(() => Promise.resolve(null)) },
};
const readWorkflowFile = mock(() => Promise.resolve(''));
const writeWorkflowFile = mock(() => Promise.resolve());
const recordTransition = mock(() => Promise.resolve());

mock.module('../../config/logger', () => ({ createLogger: () => noopLogger }));
mock.module('../../config/database', () => ({
  prisma: mockPrisma,
  ensureDatabaseConnection: () => Promise.resolve(),
}));
mock.module('./workflow-file-utils', () => ({ readWorkflowFile, writeWorkflowFile }));
mock.module('./transition-recorder', () => ({ recordTransition }));
// ensureRunnerResumes は auto-run active で早期 return する — 実 Runner/Queue の
// 起動（副作用）をテストプロセスに持ち込まないための最小モック。
mock.module('./auto-run/theme-auto-run-service', () => ({
  isThemeAutoRunActive: () => Promise.resolve(true),
}));

const { attemptVerifyRepair } = await import('./verify-self-repair');

describe('attemptVerifyRepair — stale-verdict CAS guard', () => {
  beforeEach(() => {
    mockPrisma.userSettings.findFirst.mockReset().mockResolvedValue(null);
    mockPrisma.activityLog.findFirst.mockReset().mockResolvedValue(null);
    mockPrisma.workflowTransition.count.mockReset().mockResolvedValue(0);
    mockPrisma.task.updateMany.mockReset().mockResolvedValue({ count: 1 });
    // resolveImplementEntryStatus checks the WorkflowFile row for plan.md
    mockPrisma.workflowFile.findFirst.mockReset().mockResolvedValue({ id: 1 } as unknown as null);
    readWorkflowFile.mockReset().mockResolvedValue('# plan');
    writeWorkflowFile.mockReset().mockResolvedValue(undefined);
    recordTransition.mockReset().mockResolvedValue(undefined);
  });

  test('CASが一致すれば通常どおり bounce する（plan有→plan_approved）', async () => {
    const result = await attemptVerifyRepair(551, 'verify_done', 'reason', 'verify body');
    expect(result.bounced).toBe(true);
    expect(result.stale).toBeUndefined();
    expect(result.newStatus).toBe('plan_approved');
    const call = mockPrisma.task.updateMany.mock.calls[0]?.[0] as {
      where: { id: number; workflowStatus: unknown };
    };
    // ガード条件が評価時点のステータスを固定していること（task 551 の再発防止）。
    expect(call.where).toEqual({ id: 551, workflowStatus: 'verify_done' });
    expect(writeWorkflowFile).toHaveBeenCalled();
    expect(recordTransition).toHaveBeenCalled();
  });

  test('評価中にステータスが進んでいたら(CAS 0件) 巻き戻しもフィードバック書込もしない', async () => {
    // task 551 の再現: 修正plan で re-verify が合格し completed + PR#351 済みのところへ
    // 旧 verify への遅延 verdict が到着。completed を plan_approved に戻してはならない。
    mockPrisma.task.updateMany.mockResolvedValue({ count: 0 });
    const result = await attemptVerifyRepair(551, 'verify_done', 'reason', 'verify body');
    expect(result).toEqual({ bounced: false, stale: true });
    // フィードバックは CAS 成立後にのみ書く — 合格済み verify.md を汚染しない。
    expect(writeWorkflowFile).not.toHaveBeenCalled();
    expect(recordTransition).not.toHaveBeenCalled();
  });

  test('スナップショットが completed なら即 stale（終端状態は絶対に巻き戻さない）', async () => {
    const result = await attemptVerifyRepair(551, 'completed', 'reason', 'verify body');
    expect(result).toEqual({ bounced: false, stale: true });
    expect(mockPrisma.task.updateMany).not.toHaveBeenCalled();
  });

  test('スナップショット無し(null)は terminal を除外する notIn ガードで巻き戻す', async () => {
    const result = await attemptVerifyRepair(551, null, 'reason', 'verify body');
    expect(result.bounced).toBe(true);
    const call = mockPrisma.task.updateMany.mock.calls[0]?.[0] as {
      where: { id: number; workflowStatus: unknown };
    };
    expect(call.where.workflowStatus).toEqual({ notIn: ['completed', 'verify_done'] });
  });

  test('修復上限到達は従来どおり stale なしの bounced:false（callerがblockしてよい）', async () => {
    mockPrisma.workflowTransition.count.mockResolvedValue(99);
    const result = await attemptVerifyRepair(551, 'verify_done', 'reason', 'verify body');
    expect(result.bounced).toBe(false);
    expect(result.stale).toBeUndefined();
    expect(result.cutoffRecorded).toBeUndefined();
  });
});
