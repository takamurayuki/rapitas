/**
 * apply-task-status-from-workflow テスト
 *
 * workflowStatus → Task.status のマッピング(進行中/完了/draft/読み取り不可)と、
 * DBエラー時にthrowしないこと(UI整合性のための補助処理であり、正当性ゲートではない)。
 */
import { describe, test, expect, beforeEach, mock } from 'bun:test';
import {
  applyTaskStatusFromWorkflow,
  type TaskStatusPrismaClient,
} from './apply-task-status-from-workflow';

mock.module('../../config/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}));

type TaskRow = { workflowStatus: string | null } | null;

let taskRow: TaskRow = null;
let shouldFailDb = false;
const taskUpdates: Array<Record<string, unknown>> = [];

function makePrisma(): TaskStatusPrismaClient {
  return {
    task: {
      findUnique: () =>
        shouldFailDb ? Promise.reject(new Error('db down')) : Promise.resolve(taskRow),
      update: (args: { where: { id: number }; data: Record<string, unknown> }) => {
        if (shouldFailDb) return Promise.reject(new Error('db down'));
        taskUpdates.push(args);
        return Promise.resolve({});
      },
    },
  };
}

beforeEach(() => {
  taskRow = null;
  shouldFailDb = false;
  taskUpdates.length = 0;
});

describe('applyTaskStatusFromWorkflow', () => {
  test.each(['plan_created', 'research_done', 'verify_done'])(
    'sets status to in-progress when workflowStatus is %s',
    async (workflowStatus) => {
      taskRow = { workflowStatus };
      await applyTaskStatusFromWorkflow(makePrisma(), 1, '[test]');
      expect(taskUpdates).toHaveLength(1);
      expect(taskUpdates[0]).toMatchObject({
        where: { id: 1 },
        data: { status: 'in-progress' },
      });
    },
  );

  test.each(['in_progress', 'plan_approved', 'completed'])(
    'sets status to done (with completedAt) when workflowStatus is %s',
    async (workflowStatus) => {
      taskRow = { workflowStatus };
      await applyTaskStatusFromWorkflow(makePrisma(), 1, '[test]');
      expect(taskUpdates).toHaveLength(1);
      expect(taskUpdates[0].data).toMatchObject({ status: 'done' });
      expect((taskUpdates[0].data as { completedAt: Date }).completedAt).toBeInstanceOf(Date);
    },
  );

  test('sets status to done when workflowStatus is draft', async () => {
    taskRow = { workflowStatus: 'draft' };
    await applyTaskStatusFromWorkflow(makePrisma(), 1, '[test]');
    expect(taskUpdates[0].data).toMatchObject({ status: 'done' });
  });

  test('sets status to done when an EXISTING row has no workflowStatus (single-shot run)', async () => {
    taskRow = { workflowStatus: null };
    await applyTaskStatusFromWorkflow(makePrisma(), 1, '[test]');
    expect(taskUpdates[0].data).toMatchObject({ status: 'done' });
  });

  test('leaves the status alone when the row does not exist', async () => {
    taskRow = null;
    await applyTaskStatusFromWorkflow(makePrisma(), 1, '[test]');
    expect(taskUpdates).toHaveLength(0);
  });

  test('does NOT mark the task done when the workflowStatus read fails', async () => {
    // Regression: a failed read used to collapse into the same `null` as "no
    // workflowStatus" and mark the task DONE with completedAt. Observed on task
    // 632 — the backend restarted mid-epilogue, the read failed, and a task the
    // adversarial review had REJECTED was silently recorded as complete.
    shouldFailDb = true;
    await applyTaskStatusFromWorkflow(makePrisma(), 1, '[test]');
    expect(taskUpdates).toHaveLength(0);
  });

  test('swallows DB errors instead of throwing', async () => {
    shouldFailDb = true;
    await expect(applyTaskStatusFromWorkflow(makePrisma(), 1, '[test]')).resolves.toBeUndefined();
  });
});
