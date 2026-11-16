/**
 * post-execution-review-helpers markTaskDone テスト
 *
 * post-execution review の終わりの完了書き込みが、共通の完了チェックを通ることを
 * 固定する（G2 routing1 再レビュー7 P1：markTaskDone は無条件で done と completedAt
 * を書き、ワークフローの完了状態・検証役の適格性・review hold を確認しなかった）。
 * 実物の markTaskDone・共通チェック・review hold 読み取り・ワークフロー無効判定を
 * 通し、DB と外部依存だけをモックする。
 */
import { beforeEach, expect, mock, test } from 'bun:test';

mock.module('../../../../config/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}));
mock.module('../../../../utils/ai-client', () => ({ sendAIMessage: async () => ({}) }));
mock.module('../../../../services/local-llm', () => ({
  getLocalLLMStatus: async () => ({ available: false }),
}));
mock.module('../../../../services/agents/agent-worker-manager', () => ({
  AgentWorkerManager: { getInstance: () => ({}) },
}));
mock.module('../../../../services/workflow/transition-recorder', () => ({
  recordTransition: async () => undefined,
}));
mock.module('../../../../services/memory/timeline', () => ({ appendEvent: async () => undefined }));

let workflowStatus: string | null = 'draft';
let taskStatus = 'in-progress';
let workflowDisabled = false;
let taskReadFails = false;
let holdReadFails = false;
let latestTransition: { cause: string; metadata: unknown } | null = null;
const taskUpdates: Array<{ where: { id: number }; data: Record<string, unknown> }> = [];
const prismaMock = {
  task: {
    findUnique: async (args: { select?: Record<string, boolean> }) => {
      // probeReviewHold selects haltReason; markTaskDone selects status.
      if (args.select?.haltReason && holdReadFails) throw new Error('hold read failed');
      if (args.select?.status && taskReadFails) throw new Error('task read failed');
      return { workflowStatus, status: taskStatus, haltReason: null, workflowDisabled };
    },
    update: async (args: { where: { id: number }; data: Record<string, unknown> }) => {
      taskUpdates.push(args);
      return {};
    },
    updateMany: async () => ({ count: 0 }),
  },
  userSettings: { findFirst: async () => ({ workflowDisabledGlobally: false }) },
  agentExecution: { findFirst: async () => null, findMany: async () => [] },
  workflowTransition: { findFirst: async () => latestTransition },
};
mock.module('../../../../config/database', () => ({ prisma: prismaMock }));

const { markTaskDone } = await import('./post-execution-review-helpers');
const { VERIFIER_ELIGIBILITY_DEFERRED_CAUSE } =
  await import('../../../../services/workflow/verifier-eligibility');

beforeEach(() => {
  workflowStatus = 'draft';
  taskStatus = 'in-progress';
  workflowDisabled = false;
  taskReadFails = false;
  holdReadFails = false;
  latestTransition = null;
  taskUpdates.length = 0;
});

const doneWrites = () => taskUpdates.filter((u) => u.data.status === 'done');

test('レビューの再現：implementer の実行で in_progress のまま届いても done にしない', async () => {
  workflowStatus = 'in_progress';
  await markTaskDone(1470, { sessionMode: 'workflow-implementer' });
  expect(doneWrites()).toEqual([]);
  expect(taskUpdates.filter((u) => 'completedAt' in u.data)).toEqual([]);
});

test('レビューの再現：セッションを読めなかった（undefined）なら done にしない', async () => {
  workflowStatus = 'in_progress';
  await markTaskDone(1470, { sessionMode: undefined });
  expect(doneWrites()).toEqual([]);
});

test('mode が null でワークフローが有効なら、draft でも done にしない', async () => {
  await markTaskDone(1470, { sessionMode: null });
  expect(doneWrites()).toEqual([]);
});

test.each(['research_done', 'plan_approved', 'verify_done'])(
  'ワークフローが completed でない（%s）なら done にしない',
  async (status) => {
    workflowStatus = status;
    await markTaskDone(1470, { sessionMode: 'workflow-verifier' });
    expect(doneWrites()).toEqual([]);
  },
);

test('単発と確定していても、共通チェックが拒否（検証の先送り中）すれば done にしない', async () => {
  workflowDisabled = true;
  latestTransition = { cause: VERIFIER_ELIGIBILITY_DEFERRED_CAUSE, metadata: null };
  await markTaskDone(1470, { sessionMode: null });
  expect(doneWrites()).toEqual([]);
});

test('completed でも review hold を確認できなければ done にしない', async () => {
  workflowStatus = 'completed';
  holdReadFails = true;
  await markTaskDone(1470, { sessionMode: 'workflow-verifier' });
  expect(doneWrites()).toEqual([]);
});

test('タスクを読めなければ done にしない', async () => {
  workflowStatus = 'completed';
  taskReadFails = true;
  await markTaskDone(1470, { sessionMode: 'workflow-verifier' });
  expect(taskUpdates).toEqual([]);
});

test.each(['cancelled', 'archived'])('取り下げられた（%s）タスクは done にしない', async (s) => {
  workflowStatus = 'completed';
  taskStatus = s;
  await markTaskDone(1470, { sessionMode: 'workflow-verifier' });
  expect(taskUpdates).toEqual([]);
});

test('対照：ワークフローが completed で保留もなければ done と completedAt を書く', async () => {
  workflowStatus = 'completed';
  await markTaskDone(1470, { sessionMode: 'workflow-verifier' });
  expect(taskUpdates).toHaveLength(1);
  expect(taskUpdates[0]?.data.status).toBe('done');
  expect(taskUpdates[0]?.data.completedAt).toBeInstanceOf(Date);
});

test('対照：ワークフロー無効の単発実行の draft は、共通チェックを通って done になる', async () => {
  workflowDisabled = true;
  await markTaskDone(1470, { sessionMode: null });
  expect(taskUpdates).toHaveLength(1);
  expect(taskUpdates[0]?.data.status).toBe('done');
});
