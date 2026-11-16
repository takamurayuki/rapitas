/**
 * apply-task-status-from-workflow mode 未設定テスト
 *
 * セッションの mode が null（未設定）の実行を、ワークフローでないことが確実な
 * ときだけ単発として扱うことを固定する（G2 routing1 再レビュー7 P1：execute-route
 * が mode の保存に失敗しても実行を続けると、DB から読み戻した mode は null になり、
 * mayBeWorkflowRun(null) が false なので draft のまま done と completedAt を書けた）。
 * 実物のヘルパー・共通チェック・ワークフロー無効判定を通し、DB だけをモックする。
 */
import { beforeEach, expect, mock, test } from 'bun:test';

mock.module('../../config/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}));
mock.module('./transition-recorder', () => ({ recordTransition: async () => undefined }));
mock.module('../memory/timeline', () => ({ appendEvent: async () => undefined }));

let workflowStatus: string | null = 'draft';
let taskWorkflowDisabled = false;
let globalWorkflowDisabled = false;
let settingsReadFails = false;
const taskUpdates: Array<{ where: { id: number }; data: Record<string, unknown> }> = [];
const prismaMock = {
  task: {
    // Serves the helper's read, the review-hold read and workflow-disabled's read.
    findUnique: async () => ({
      workflowStatus,
      status: 'in-progress',
      haltReason: null,
      workflowDisabled: taskWorkflowDisabled,
    }),
    update: async (args: { where: { id: number }; data: Record<string, unknown> }) => {
      taskUpdates.push(args);
      return {};
    },
    updateMany: async () => ({ count: 0 }),
  },
  userSettings: {
    findFirst: async () => {
      if (settingsReadFails) throw new Error('db down');
      return { workflowDisabledGlobally: globalWorkflowDisabled };
    },
  },
  // No verifier run, no verify records: the shared check allows (no_verifier_run).
  agentExecution: { findFirst: async () => null, findMany: async () => [] },
  workflowTransition: { findFirst: async () => null },
};
mock.module('../../config/database', () => ({ prisma: prismaMock }));

const { applyTaskStatusFromWorkflow } = await import('./apply-task-status-from-workflow');

beforeEach(() => {
  workflowStatus = 'draft';
  taskWorkflowDisabled = false;
  globalWorkflowDisabled = false;
  settingsReadFails = false;
  taskUpdates.length = 0;
});

const doneWrites = () => taskUpdates.filter((u) => u.data.status === 'done');

test('レビューの再現：mode が null でワークフローが有効なら、draft を done にせず completedAt も書かない', async () => {
  await applyTaskStatusFromWorkflow(prismaMock, 1470, '[test]', { sessionMode: null });
  expect(doneWrites()).toEqual([]);
  expect(taskUpdates.filter((u) => 'completedAt' in u.data)).toEqual([]);
});

test('mode が null で workflowStatus も null のとき、ワークフローが有効なら done にしない', async () => {
  workflowStatus = null;
  await applyTaskStatusFromWorkflow(prismaMock, 1470, '[test]', { sessionMode: null });
  expect(taskUpdates).toEqual([]);
});

test('ワークフロー無効の設定を読めないときは、単発と確定できないので done にしない', async () => {
  settingsReadFails = true;
  await applyTaskStatusFromWorkflow(prismaMock, 1470, '[test]', { sessionMode: null });
  expect(taskUpdates).toEqual([]);
});

test('ワークフロー以外の mode が付いていても、ワークフローが有効なら単発と確定しない', async () => {
  await applyTaskStatusFromWorkflow(prismaMock, 1470, '[test]', { sessionMode: 'continuation' });
  expect(taskUpdates).toEqual([]);
});

test('mode が workflow-* なら、ワークフロー無効の設定があっても done にしない', async () => {
  taskWorkflowDisabled = true;
  await applyTaskStatusFromWorkflow(prismaMock, 1470, '[test]', {
    sessionMode: 'workflow-implementer',
  });
  expect(taskUpdates).toEqual([]);
});

test.each([
  ['タスク単位', () => (taskWorkflowDisabled = true)],
  ['全体設定', () => (globalWorkflowDisabled = true)],
])(
  '対照：ワークフローが無効（%s）なら単発と確定し、共通チェックを通って done になる',
  async (_label, disable) => {
    disable();
    await applyTaskStatusFromWorkflow(prismaMock, 1470, '[test]', { sessionMode: null });
    expect(taskUpdates).toHaveLength(1);
    expect(taskUpdates[0]?.data.status).toBe('done');
    expect(taskUpdates[0]?.data.completedAt).toBeInstanceOf(Date);
  },
);
