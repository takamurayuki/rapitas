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

function sizedPlan(items: number, files: number): string {
  const rows = Array.from({ length: files }, (_, i) => `- \`pkg/d${i}/f${i}.ts\``).join('\n');
  const checks = Array.from({ length: items }, (_, i) => `- [ ] 項目 ${i}`).join('\n');
  return `## 変更予定ファイル\n\n${rows}\n\n## 実装チェックリスト\n\n${checks}\n`;
}

describe('runPlanPostProcessing — 計画の大きさ警告（task 1540）', () => {
  const warnings = () => recorded.filter((r) => r.cause === 'plan_oversized_warning');

  test('チェックリスト 11 項目で警告が 1 件記録され、自動承認は止まらない', async () => {
    await runPlanPostProcessing({ ...baseParams, content: sizedPlan(11, 1) });
    expect(warnings()).toHaveLength(1);
    expect(warnings()[0]?.metadata).toMatchObject({ checklistItems: 11, changedFiles: 1 });
    expect(maybeAutoApprovePlan).toHaveBeenCalledTimes(1);
  });

  test('変更予定ファイル 16 件で警告が 1 件記録される', async () => {
    await runPlanPostProcessing({ ...baseParams, content: sizedPlan(1, 16) });
    expect(warnings()).toHaveLength(1);
  });

  test('境界値の 10 項目・15 ファイルでは記録されない', async () => {
    await runPlanPostProcessing({ ...baseParams, content: sizedPlan(10, 15) });
    expect(warnings()).toHaveLength(0);
    expect(maybeAutoApprovePlan).toHaveBeenCalledTimes(1);
  });

  test('plan 以外の保存では記録されない', async () => {
    await runPlanPostProcessing({
      ...baseParams,
      fileType: 'research',
      content: sizedPlan(30, 30),
    });
    expect(warnings()).toHaveLength(0);
  });
});
