/**
 * apply-task-status-from-workflow テスト
 *
 * workflowStatus → Task.status のマッピング(進行中/完了/draft/読み取り不可)と、
 * DBエラー時にthrowしないこと。
 * in_progress / plan_approved は検証が残っているので done にしないこと、
 * draft / null で done にする前に共通の完了チェックを通すことも固定する
 * （G2 routing1 再レビュー5 指摘2：検証未完了のまま done と completedAt を保存し、
 * 子タスクの成功判定 status === 'done' で成功扱いになり得た）。
 */
import { describe, test, expect, beforeEach, mock } from 'bun:test';
import {
  applyTaskStatusFromWorkflow,
  type TaskStatusPrismaClient,
} from './apply-task-status-from-workflow';

mock.module('../../config/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}));

let confirmed = true;
const verifierConfirmedForCompletion = mock(async (_taskId: number, _source: string) => confirmed);
mock.module('./verifier-completion-check', () => ({ verifierConfirmedForCompletion }));

// Most cases exercise the single-shot mapping; workflow runs are pinned in
// apply-task-status-from-workflow.workflow-draft.test.ts, and the real
// run-kind decision (null mode → workflow-disabled setting) in
// apply-task-status-from-workflow.null-mode.test.ts. Here a null mode stands
// for a run already confirmed single-shot unless `certainSingleShot` is off.
let certainSingleShot = true;
const isCertainlySingleShotRun = mock(
  async (_taskId: number, mode: string | null | undefined) => certainSingleShot && mode === null,
);
mock.module('./finished-run-kind', () => ({ isCertainlySingleShotRun }));
const SINGLE_SHOT = { sessionMode: null };

type TaskRow = { workflowStatus: string | null; status?: string | null } | null;

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
  confirmed = true;
  certainSingleShot = true;
  verifierConfirmedForCompletion.mockClear();
  isCertainlySingleShotRun.mockClear();
});

describe('applyTaskStatusFromWorkflow', () => {
  // 2026-09-25 #1079/#1087: an operator cancel landed while a phase was still
  // running; the finishing phase wrote 'in-progress' back and the runner
  // dispatched the next phase of a cancelled task.
  test.each(['cancelled', 'archived'])(
    'leaves a task withdrawn mid-run alone (status %s)',
    async (status) => {
      taskRow = { workflowStatus: 'research_done', status };
      await applyTaskStatusFromWorkflow(makePrisma(), 1, '[test]', SINGLE_SHOT);
      expect(taskUpdates).toHaveLength(0);
    },
  );

  // in_progress / plan_approved: the implementation has run but the verify
  // phase has not — the task is not finished, so it must not read as done.
  test.each(['plan_created', 'research_done', 'verify_done', 'in_progress', 'plan_approved'])(
    'sets status to in-progress when workflowStatus is %s',
    async (workflowStatus) => {
      taskRow = { workflowStatus };
      await applyTaskStatusFromWorkflow(makePrisma(), 1, '[test]', SINGLE_SHOT);
      expect(taskUpdates).toHaveLength(1);
      expect(taskUpdates[0]).toMatchObject({
        where: { id: 1 },
        data: { status: 'in-progress' },
      });
      expect(taskUpdates[0].data).not.toHaveProperty('completedAt');
    },
  );

  test('sets status to done (with completedAt) when workflowStatus is completed', async () => {
    taskRow = { workflowStatus: 'completed' };
    await applyTaskStatusFromWorkflow(makePrisma(), 1, '[test]', SINGLE_SHOT);
    expect(taskUpdates).toHaveLength(1);
    expect(taskUpdates[0].data).toMatchObject({ status: 'done' });
    expect((taskUpdates[0].data as { completedAt: Date }).completedAt).toBeInstanceOf(Date);
  });

  test.each(['draft', null])(
    'asks the shared completion check before marking a %s task done',
    async (workflowStatus) => {
      taskRow = { workflowStatus };
      await applyTaskStatusFromWorkflow(makePrisma(), 7, '[test]', SINGLE_SHOT);
      expect(verifierConfirmedForCompletion).toHaveBeenCalledWith(7, 'status_sync');
      expect(taskUpdates[0].data).toMatchObject({ status: 'done' });
    },
  );

  test.each(['draft', null])(
    'does NOT mark a %s task done when the shared completion check refuses',
    async (workflowStatus) => {
      taskRow = { workflowStatus };
      confirmed = false;
      await applyTaskStatusFromWorkflow(makePrisma(), 7, '[test]', SINGLE_SHOT);
      expect(taskUpdates).toHaveLength(0);
    },
  );

  test.each(['workflow-researcher', undefined])(
    'does not even ask the completion check for a draft task after run kind %p',
    async (sessionMode) => {
      taskRow = { workflowStatus: 'draft' };
      await applyTaskStatusFromWorkflow(makePrisma(), 7, '[test]', { sessionMode });
      expect(verifierConfirmedForCompletion).not.toHaveBeenCalled();
      expect(taskUpdates).toHaveLength(0);
    },
  );

  test('leaves a draft task alone when the run is not certainly single-shot', async () => {
    taskRow = { workflowStatus: 'draft' };
    certainSingleShot = false;
    await applyTaskStatusFromWorkflow(makePrisma(), 7, '[test]', SINGLE_SHOT);
    expect(isCertainlySingleShotRun).toHaveBeenCalledWith(7, null);
    expect(verifierConfirmedForCompletion).not.toHaveBeenCalled();
    expect(taskUpdates).toHaveLength(0);
  });

  test('sets status to done when workflowStatus is draft', async () => {
    taskRow = { workflowStatus: 'draft' };
    await applyTaskStatusFromWorkflow(makePrisma(), 1, '[test]', SINGLE_SHOT);
    expect(taskUpdates[0].data).toMatchObject({ status: 'done' });
  });

  test('sets status to done when an EXISTING row has no workflowStatus (single-shot run)', async () => {
    taskRow = { workflowStatus: null };
    await applyTaskStatusFromWorkflow(makePrisma(), 1, '[test]', SINGLE_SHOT);
    expect(taskUpdates[0].data).toMatchObject({ status: 'done' });
  });

  test('leaves the status alone when the row does not exist', async () => {
    taskRow = null;
    await applyTaskStatusFromWorkflow(makePrisma(), 1, '[test]', SINGLE_SHOT);
    expect(taskUpdates).toHaveLength(0);
  });

  test('does NOT mark the task done when the workflowStatus read fails', async () => {
    // Regression: a failed read used to collapse into the same `null` as "no
    // workflowStatus" and mark the task DONE with completedAt. Observed on task
    // 632 — the backend restarted mid-epilogue, the read failed, and a task the
    // adversarial review had REJECTED was silently recorded as complete.
    shouldFailDb = true;
    await applyTaskStatusFromWorkflow(makePrisma(), 1, '[test]', SINGLE_SHOT);
    expect(taskUpdates).toHaveLength(0);
  });

  test('swallows DB errors instead of throwing', async () => {
    shouldFailDb = true;
    await expect(
      applyTaskStatusFromWorkflow(makePrisma(), 1, '[test]', SINGLE_SHOT),
    ).resolves.toBeUndefined();
  });
});
