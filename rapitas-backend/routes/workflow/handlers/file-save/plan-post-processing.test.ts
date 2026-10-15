/**
 * plan-post-processing テスト
 *
 * スキーマ変更を宣言したplan保存は自動承認をスキップし
 * auto_approve_blocked_forbidden_change を記録すること、スキーマ変更を含まない
 * plan保存は従来通り自動承認されること、古いoverrideがリセットされることを検証する。
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

const taskUpdates: Array<Record<string, unknown>> = [];
let taskRow: { forbiddenChangeOverride: boolean } | null = { forbiddenChangeOverride: false };

mock.module('../../../../config/database', () => ({
  prisma: {
    task: {
      findUnique: () => Promise.resolve(taskRow),
      update: (args: Record<string, unknown>) => {
        taskUpdates.push(args);
        return Promise.resolve({});
      },
    },
  },
  ensureDatabaseConnection: () => Promise.resolve(),
}));

mock.module('../../../../config/logger', () => {
  const noop = { info() {}, warn() {}, error() {}, debug() {}, fatal() {} };
  return { createLogger: () => noop, logger: noop, getBackendLogFilePath: () => '/tmp/b.log' };
});

const recorded: Array<Record<string, unknown>> = [];
mock.module('../../../../services/workflow/transition-recorder', () => ({
  recordTransition: (t: Record<string, unknown>) => {
    recorded.push(t);
    return Promise.resolve();
  },
}));

const maybeAutoApprovePlan = mock(async () => ({ autoApproved: false }));
mock.module('../../../../services/workflow/plan-auto-approve', () => ({
  maybeAutoApprovePlan,
}));

mock.module('../../../../services/workflow/subtask-split-policy', () => ({
  isSubtaskSplitEnabled: () => false,
}));

mock.module('../../../../services/workflow/workflow-file-utils', () => ({
  readWorkflowFile: () => Promise.resolve(null),
}));

const { runPlanPostProcessing } = await import('./plan-post-processing');

beforeEach(() => {
  taskUpdates.length = 0;
  recorded.length = 0;
  maybeAutoApprovePlan.mockClear();
  taskRow = { forbiddenChangeOverride: false };
});

const baseParams = {
  taskId: 1059,
  fileType: 'plan' as const,
  newStatus: 'plan_created',
  fileLanguage: 'ja' as const,
};

describe('runPlanPostProcessing — スキーマ変更を宣言したplan', () => {
  test('maybeAutoApprovePlan を呼ばず auto_approve_blocked_forbidden_change を記録する', async () => {
    const content = '対象ファイル: `rapitas-backend/prisma/schema/pause.prisma`';
    const result = await runPlanPostProcessing({ ...baseParams, content });

    expect(maybeAutoApprovePlan).not.toHaveBeenCalled();
    expect(result.autoApproved).toBe(false);
    expect(recorded).toHaveLength(1);
    expect(recorded[0]?.cause).toBe('auto_approve_blocked_forbidden_change');
    expect(recorded[0]?.taskId).toBe(1059);
  });

  test('既存の forbiddenChangeOverride:true をリセットする', async () => {
    taskRow = { forbiddenChangeOverride: true };
    const content = '対象ファイル: `rapitas-backend/prisma/schema/pause.prisma`';
    await runPlanPostProcessing({ ...baseParams, content });

    expect(taskUpdates).toHaveLength(1);
    expect(taskUpdates[0]?.data).toEqual({ forbiddenChangeOverride: false });
  });
});

describe('runPlanPostProcessing — スキーマ変更を含まないplan（回帰確認）', () => {
  test('従来通り maybeAutoApprovePlan が呼ばれる', async () => {
    const content = '対象ファイル: `src/foo.ts`';
    await runPlanPostProcessing({ ...baseParams, content });

    expect(maybeAutoApprovePlan).toHaveBeenCalledTimes(1);
    expect(recorded).toHaveLength(0);
  });

  test('既存の forbiddenChangeOverride:true があればリセットしてから自動承認処理を続行する', async () => {
    taskRow = { forbiddenChangeOverride: true };
    const content = '対象ファイル: `src/foo.ts`';
    await runPlanPostProcessing({ ...baseParams, content });

    expect(taskUpdates).toHaveLength(1);
    expect(taskUpdates[0]?.data).toEqual({ forbiddenChangeOverride: false });
    expect(maybeAutoApprovePlan).toHaveBeenCalledTimes(1);
  });

  test('forbiddenChangeOverride:false の場合はリセット更新を発行しない', async () => {
    taskRow = { forbiddenChangeOverride: false };
    const content = '対象ファイル: `src/foo.ts`';
    await runPlanPostProcessing({ ...baseParams, content });

    expect(taskUpdates).toHaveLength(0);
    expect(maybeAutoApprovePlan).toHaveBeenCalledTimes(1);
  });
});
