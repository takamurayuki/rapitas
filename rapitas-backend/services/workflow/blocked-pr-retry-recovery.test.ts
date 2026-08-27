/**
 * blocked-pr-retry-recovery ユニットテスト
 *
 * attemptPrOnlyRecovery の3系統（PR作成成功→完了/PR作成失敗→
 * PR_RETRY_LIGHTWEIGHT_CAUSE記録/既にPRリンク済み→即完了）を、
 * performAutoCommitAndPR の呼び出し有無を直接アサートして検証する
 * （プレモーテム#1: mock.module の相対パスがソースの実際の import
 * 解決先とズレるとモックが効かず偽陽性で通過するリスクへの対策）。
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

const noopLogger = {
  info: () => {},
  error: () => {},
  warn: () => {},
  debug: () => {},
  fatal: () => {},
};
mock.module('../../config/logger', () => ({
  createLogger: () => noopLogger,
  logger: noopLogger,
  getBackendLogFilePath: () => '/tmp/backend.log',
}));

const mockTaskUpdateMany = mock(() => Promise.resolve({ count: 1 }));
mock.module('../../config/database', () => ({
  prisma: { task: { updateMany: mockTaskUpdateMany } },
}));

const mockReadWorkflowFile = mock(() => Promise.resolve('# verify.md content'));
mock.module('./workflow-file-utils', () => ({
  readWorkflowFile: mockReadWorkflowFile,
}));

const mockRecordTransition = mock(() => Promise.resolve());
mock.module('./transition-recorder', () => ({
  recordTransition: mockRecordTransition,
}));

let linkedPr = false;
const mockTaskHasLinkedPr = mock(() => Promise.resolve(linkedPr));
mock.module('./workflow-cli-executor-helpers', () => ({
  taskHasLinkedPr: mockTaskHasLinkedPr,
}));

type AutoCommitPRResultLike = {
  autoCommitResult?: { success: boolean; filesChanged?: number; error?: string };
  autoPRResult?: { success: boolean; prUrl?: string; prNumber?: number; error?: string };
  error?: string;
};
let acprResult: AutoCommitPRResultLike = {
  autoCommitResult: { success: true },
  autoPRResult: { success: true, prUrl: 'https://example.com/pr/1', prNumber: 1 },
};
const mockPerformAutoCommitAndPR = mock(() => Promise.resolve(acprResult));
mock.module('../../routes/workflow/workflow-auto-commit', () => ({
  performAutoCommitAndPR: mockPerformAutoCommitAndPR,
}));

const { attemptPrOnlyRecovery } = await import('./blocked-pr-retry-recovery');

describe('attemptPrOnlyRecovery', () => {
  beforeEach(() => {
    mockTaskUpdateMany.mockClear();
    mockReadWorkflowFile.mockClear();
    mockRecordTransition.mockClear();
    mockTaskHasLinkedPr.mockClear();
    mockPerformAutoCommitAndPR.mockClear();
    linkedPr = false;
    acprResult = {
      autoCommitResult: { success: true },
      autoPRResult: { success: true, prUrl: 'https://example.com/pr/1', prNumber: 1 },
    };
    mockTaskUpdateMany.mockResolvedValue({ count: 1 });
  });

  test('PR作成成功: performAutoCommitAndPRが呼ばれ、taskが完了しverify_passedが記録され、trueを返す', async () => {
    const result = await attemptPrOnlyRecovery(673);

    expect(mockPerformAutoCommitAndPR).toHaveBeenCalledTimes(1);
    expect(mockTaskUpdateMany).toHaveBeenCalledWith({
      where: { id: 673, workflowStatus: 'verify_done' },
      data: expect.objectContaining({ status: 'done', workflowStatus: 'completed' }),
    });
    expect(mockRecordTransition).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 673, cause: 'verify_passed', toStatus: 'completed' }),
    );
    expect(result).toBe(true);
  });

  test('PR作成失敗: performAutoCommitAndPRが呼ばれるが、PR_RETRY_LIGHTWEIGHT_CAUSEを記録しfalseを返す（完了させない）', async () => {
    acprResult = {
      autoCommitResult: { success: true, filesChanged: 3 },
      autoPRResult: { success: false, error: 'gh pr create failed' },
    };
    linkedPr = false;

    const result = await attemptPrOnlyRecovery(673);

    expect(mockPerformAutoCommitAndPR).toHaveBeenCalledTimes(1);
    expect(mockRecordTransition).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 673, cause: 'verify_pr_retry_lightweight' }),
    );
    expect(mockTaskUpdateMany).not.toHaveBeenCalled();
    expect(result).toBe(false);
  });

  test('既にPRリンク済み: performAutoCommitAndPRを呼ばずに直接完了扱いにし、trueを返す', async () => {
    linkedPr = true;

    const result = await attemptPrOnlyRecovery(673);

    expect(mockPerformAutoCommitAndPR).not.toHaveBeenCalled();
    expect(mockTaskUpdateMany).toHaveBeenCalledWith({
      where: { id: 673, workflowStatus: 'verify_done' },
      data: expect.objectContaining({ status: 'done', workflowStatus: 'completed' }),
    });
    expect(result).toBe(true);
  });
});
