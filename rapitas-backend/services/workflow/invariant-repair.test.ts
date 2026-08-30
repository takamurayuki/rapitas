/**
 * invariant-repair.test
 *
 * Task 766 — repairMissingFile: rolls workflowStatus back to the nearest
 * checkpoint whose required files are all present, but only when doing so is
 * unambiguous (nothing exists beyond that checkpoint, no live execution).
 */
import { describe, expect, test, mock, beforeEach } from 'bun:test';

const noopLogger = { info: mock(() => {}), warn: mock(() => {}), error: () => {}, debug: () => {} };

const mockTaskFindUnique = mock(() =>
  Promise.resolve<{ workflowStatus: string; workflowMode: string } | null>(null),
);
const mockTaskUpdate = mock(() => Promise.resolve({}));
const mockWorkflowFileFindMany = mock(() => Promise.resolve([] as { fileType: string }[]));
const mockAgentExecutionFindFirst = mock(() => Promise.resolve<{ id: number } | null>(null));

const mockPrisma = {
  task: { findUnique: mockTaskFindUnique, update: mockTaskUpdate },
  workflowFile: { findMany: mockWorkflowFileFindMany },
  agentExecution: { findFirst: mockAgentExecutionFindFirst },
};

mock.module('../../config/logger', () => ({ createLogger: () => noopLogger }));
mock.module('../../config/database', () => ({
  prisma: mockPrisma,
  ensureDatabaseConnection: () => Promise.resolve(),
}));
mock.module('./workflow-reconciler-requeue', () => ({
  ACTIVE_EXEC: ['running', 'pending', 'waiting_for_input'],
}));
const mockGetModeSettings = mock((mode: string) =>
  Promise.resolve({
    mode,
    includePlan: mode !== 'lightweight',
    autoVerify: mode === 'lightweight',
    complexityMin: 0,
    complexityMax: 100,
    isEnabled: true,
  }),
);
mock.module('./workflow-mode-config', () => ({ getModeSettings: mockGetModeSettings }));

const { repairMissingFile } = await import('./invariant-repair');

function violation(message: string): { code: 'missing_file'; message: string } {
  return { code: 'missing_file', message };
}

describe('repairMissingFile', () => {
  beforeEach(() => {
    mockTaskFindUnique.mockReset().mockResolvedValue({
      workflowStatus: 'in_progress',
      workflowMode: 'standard',
    });
    mockTaskUpdate.mockReset().mockResolvedValue({});
    mockWorkflowFileFindMany.mockReset().mockResolvedValue([]);
    mockAgentExecutionFindFirst.mockReset().mockResolvedValue(null);
    mockGetModeSettings.mockClear();
  });

  test('正常系: research.md のみ存在し plan.md 不足 → research_done へロールバックして repaired:true', async () => {
    mockWorkflowFileFindMany.mockResolvedValue([{ fileType: 'research' }]);

    const result = await repairMissingFile(
      100,
      violation('workflowStatus="in_progress" but plan.md is missing'),
    );

    expect(result).toEqual({ repaired: true, newStatus: 'research_done' });
    expect(mockTaskUpdate).toHaveBeenCalledWith({
      where: { id: 100 },
      data: { workflowStatus: 'research_done', updatedAt: expect.any(Date) },
    });
  });

  test('修復不可（後続ファイルが存在）: research.md も plan.md も無いのに verify.md だけ存在 → repaired:false', async () => {
    mockTaskFindUnique.mockResolvedValue({
      workflowStatus: 'verify_done',
      workflowMode: 'standard',
    });
    mockWorkflowFileFindMany.mockResolvedValue([{ fileType: 'verify' }]);

    const result = await repairMissingFile(
      101,
      violation('workflowStatus="verify_done" but research.md is missing'),
    );

    expect(result.repaired).toBe(false);
    expect(result.reason).toBe('no_safe_checkpoint');
    expect(mockTaskUpdate).not.toHaveBeenCalled();
  });

  test('修復不可（安全な巻き戻し先を超えてファイルが存在）: research.md のみ present、plan/verify 不足だが verify.md が存在 → repaired:false', async () => {
    mockTaskFindUnique.mockResolvedValue({
      workflowStatus: 'verify_done',
      workflowMode: 'standard',
    });
    mockWorkflowFileFindMany.mockResolvedValue([{ fileType: 'research' }, { fileType: 'verify' }]);

    const result = await repairMissingFile(
      102,
      violation('workflowStatus="verify_done" but plan.md is missing'),
    );

    expect(result.repaired).toBe(false);
    expect(result.reason).toBe('files_exist_beyond_checkpoint');
    expect(mockTaskUpdate).not.toHaveBeenCalled();
  });

  test('修復不可（実行中）: liveExecution が存在する場合は修復しない', async () => {
    mockWorkflowFileFindMany.mockResolvedValue([{ fileType: 'research' }]);
    mockAgentExecutionFindFirst.mockResolvedValue({ id: 1 });

    const result = await repairMissingFile(
      103,
      violation('workflowStatus="in_progress" but plan.md is missing'),
    );

    expect(result).toEqual({ repaired: false, reason: 'live_execution_in_progress' });
    expect(mockTaskUpdate).not.toHaveBeenCalled();
  });

  test('DB失敗系: task.update が例外を投げても fail-open で repaired:false を返す', async () => {
    mockWorkflowFileFindMany.mockResolvedValue([{ fileType: 'research' }]);
    mockTaskUpdate.mockImplementation(() => Promise.reject(new Error('db down')));

    const result = await repairMissingFile(
      104,
      violation('workflowStatus="in_progress" but plan.md is missing'),
    );

    expect(result).toEqual({ repaired: false, reason: 'db_update_failed' });
  });

  test('code が missing_file 以外の場合は即座に repaired:false', async () => {
    const result = await repairMissingFile(105, {
      code: 'status_mismatch',
      message: 'x',
    });

    expect(result).toEqual({ repaired: false, reason: 'not_missing_file_code' });
    expect(mockTaskFindUnique).not.toHaveBeenCalled();
  });

  test('タスクが見つからない場合は repaired:false', async () => {
    mockTaskFindUnique.mockResolvedValue(null);

    const result = await repairMissingFile(106, violation('x'));

    expect(result).toEqual({ repaired: false, reason: 'task_not_found' });
  });
});
