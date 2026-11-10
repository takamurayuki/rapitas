/**
 * apply-task-status-from-workflow ワークフロー draft テスト
 *
 * ワークフロー実行（セッションの mode が workflow-*）の draft／null を、状態同期が
 * done にしないことを固定する（G2 routing1 再レビュー6 P1：draft は単発実行と同じ
 * 分岐に入り、検証役の実行がないので共通チェックが no_verifier_run で許可し、
 * 未検証のワークフロータスクに status: "done" と completedAt が書かれた）。
 * 実物のヘルパー・共通チェック・適格性判定を通し、DB だけをモックする。
 */
import { beforeEach, expect, mock, test } from 'bun:test';

mock.module('../../config/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}));
mock.module('./transition-recorder', () => ({ recordTransition: async () => undefined }));
mock.module('../memory/timeline', () => ({ appendEvent: async () => undefined }));

let workflowStatus: string | null = 'draft';
let workflowDisabled = false;
const taskUpdates: Array<{ where: { id: number }; data: Record<string, unknown> }> = [];
const prismaMock = {
  task: {
    // Serves both the helper's read and the review-hold read: no hold.
    // ...and workflow-disabled's read (task flag; userSettings is absent → not global).
    findUnique: async () => ({
      workflowStatus,
      status: 'in-progress',
      haltReason: null,
      workflowDisabled,
    }),
    update: async (args: { where: { id: number }; data: Record<string, unknown> }) => {
      taskUpdates.push(args);
      return {};
    },
    updateMany: async () => ({ count: 0 }),
  },
  // No verifier run, no verify records — the review's reproduction.
  agentExecution: { findFirst: async () => null, findMany: async () => [] },
  workflowTransition: { findFirst: async () => null },
};
mock.module('../../config/database', () => ({ prisma: prismaMock }));

const { applyTaskStatusFromWorkflow } = await import('./apply-task-status-from-workflow');
const { verifierConfirmedForCompletion } = await import('./verifier-completion-check');

beforeEach(() => {
  workflowStatus = 'draft';
  workflowDisabled = false;
  taskUpdates.length = 0;
});

test('前提：検証役の実行がなければ、実物の共通チェックは許可する（no_verifier_run）', async () => {
  expect(await verifierConfirmedForCompletion(1470, 'status_sync')).toBe(true);
});

test.each(['workflow-researcher', 'workflow-planner', 'workflow-implementer', 'workflow-verifier'])(
  'レビューの再現：ワークフロー実行（%s）の draft は done にせず completedAt も書かない',
  async (sessionMode) => {
    await applyTaskStatusFromWorkflow(prismaMock, 1470, '[test]', { sessionMode });
    expect(taskUpdates.filter((u) => u.data.status === 'done')).toEqual([]);
    expect(taskUpdates.filter((u) => 'completedAt' in u.data)).toEqual([]);
  },
);

test('ワークフロー実行で workflowStatus が null でも done にしない', async () => {
  workflowStatus = null;
  await applyTaskStatusFromWorkflow(prismaMock, 1470, '[test]', {
    sessionMode: 'workflow-researcher',
  });
  expect(taskUpdates).toEqual([]);
});

test('実行種別を確認できない（undefined）ときは draft を done にしない', async () => {
  await applyTaskStatusFromWorkflow(prismaMock, 1470, '[test]', { sessionMode: undefined });
  expect(taskUpdates).toEqual([]);
});

// NOTE: The control used to be mode null / 'continuation' with the workflow
// enabled. Neither proves a single run (G2 routing1 re-review 7); only a
// disabled workflow does — see apply-task-status-from-workflow.null-mode.test.ts.
test('単発実行（ワークフロー無効・mode null）の draft は、実物の共通チェックが許可すれば done になる（対照）', async () => {
  workflowDisabled = true;
  await applyTaskStatusFromWorkflow(prismaMock, 1470, '[test]', { sessionMode: null });
  expect(taskUpdates).toHaveLength(1);
  expect(taskUpdates[0]?.data.status).toBe('done');
  expect(taskUpdates[0]?.data.completedAt).toBeInstanceOf(Date);
});

test('ワークフロー実行でも workflowStatus が completed なら done にする（対照）', async () => {
  workflowStatus = 'completed';
  await applyTaskStatusFromWorkflow(prismaMock, 1470, '[test]', {
    sessionMode: 'workflow-verifier',
  });
  expect(taskUpdates[0]?.data.status).toBe('done');
});
