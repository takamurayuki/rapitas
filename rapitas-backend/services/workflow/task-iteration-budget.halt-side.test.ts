/**
 * task-iteration-budget halt-side 自己カウント回帰テスト
 *
 * resolveIterationBudgetForTask が iteration_budget_halted / auto_run_hang_backstop
 * の遷移を反復原因・同一status反復として数えないこと(task 995, 984/985 の12秒halt
 * ループ)を、DB配線込みで検証する。
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

// 呼び出し環境の閾値上書きに依存しないよう既定値へ固定する
process.env.RAPITAS_ITERATION_NO_PROGRESS_STATUS_REPEAT_MIN = '2';
process.env.RAPITAS_ITERATION_NO_PROGRESS_ATTEMPTS_MIN = '3';
process.env.RAPITAS_ITERATION_ATTEMPTS_BUDGET = '8';

const NOW_MS = 1_700_000_000_000;
let transitions: Array<{
  cause: string;
  createdAt: Date;
  actor: string;
  invariantViolation: null;
  fromStatus: string;
  toStatus: string;
}> = [];

// The budget module's import chain (task-iteration-budget-status → executor
// helpers → config index) needs every export the real modules carry: a partial
// mock throws "export not found" at load time when this file runs on its own.
mock.module('../../config/database', () => ({
  ensureDatabaseConnection: () => Promise.resolve(),
  prisma: {
    task: {
      findUnique: mock(() =>
        Promise.resolve({ workflowStatus: 'verify_done', createdAt: new Date(NOW_MS - 3_600_000) }),
      ),
    },
    agentExecution: { count: mock(() => Promise.resolve(5)) },
    workflowTransition: {
      findFirst: mock(() => Promise.resolve(null)),
      findMany: mock(() => Promise.resolve(transitions)),
    },
  },
}));
const noopLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
mock.module('../../config/logger', () => ({
  createLogger: () => noopLogger,
  logger: noopLogger,
  getBackendLogFilePath: () => '/tmp/backend.log',
}));
mock.module('./task-budget', () => ({
  getTaskSpendUsd: () => Promise.resolve(0),
  getTaskSpendUsdSince: () => Promise.resolve(0),
}));
mock.module('../memory/concern-backlog-service', () => ({
  submitConcern: () => Promise.resolve({ id: 1, outcome: 'created' as const }),
}));

const { resolveIterationBudgetForTask } = await import('./task-iteration-budget');

function makeTransitions(cause: string, n: number) {
  return Array.from({ length: n }, (_, i) => ({
    cause,
    createdAt: new Date(NOW_MS - 60_000 - i * 1000),
    actor: 'system',
    invariantViolation: null,
    // Same-status re-record: countNonAdvancingTransitions (task 994) only counts
    // rows that carry a fromStatus, so the fixture must state it explicitly.
    fromStatus: 'verify_done',
    toStatus: 'verify_done',
  }));
}

describe('resolveIterationBudgetForTask — halt-side 遷移の自己カウント除外', () => {
  beforeEach(() => {
    transitions = [];
  });

  for (const cause of ['iteration_budget_halted', 'auto_run_hang_backstop']) {
    test(`${cause} のみが51件あっても停止判定しない`, async () => {
      transitions = makeTransitions(cause, 51);
      const result = await resolveIterationBudgetForTask(984, {}, NOW_MS);
      expect(result.shouldHalt).toBe(false);
    });
  }

  test('halt-side が混在しても作業側の遷移だけで判定される(対照)', async () => {
    transitions = [
      ...makeTransitions('iteration_budget_halted', 51),
      ...makeTransitions('verify_pr_not_created', 51),
    ];
    const withHalt = await resolveIterationBudgetForTask(984, {}, NOW_MS);
    transitions = makeTransitions('verify_pr_not_created', 51);
    const workOnly = await resolveIterationBudgetForTask(984, {}, NOW_MS);
    expect(withHalt).toEqual(workOnly);
    expect(workOnly.shouldHalt).toBe(true);
  });
});
