/**
 * task-iteration-budget PR 待ち integration テスト
 *
 * #1009 / PR #776 相当(verify_repair ×4 の後に PR 作成・マージ待ち)で
 * repeat_cause / no_progress の誤 halt が起きないこと、成功後に CI 修復が
 * 反復した場合は従来どおり halt されることを検証する。
 */
import { describe, test, expect, mock, beforeAll, afterAll } from 'bun:test';

const NOW = 1_700_000_000_000;
const created = new Date(NOW - 50 * 60_000);
let taskRow: { workflowStatus: string; createdAt: Date; githubPrId: number | null } = {
  workflowStatus: 'verify_done',
  createdAt: created,
  githubPrId: null,
};
let transitions: Array<{
  cause: string | null;
  createdAt: Date;
  actor: string | null;
  invariantViolation: string | null;
  fromStatus: string | null;
  toStatus: string;
}> = [];

mock.module('../../config/database', () => ({
  prisma: {
    task: { findUnique: mock(() => Promise.resolve(taskRow)) },
    agentExecution: { count: mock(() => Promise.resolve(4)) },
    workflowTransition: {
      findFirst: mock(() => Promise.resolve(null)),
      findMany: mock(() => Promise.resolve(transitions)),
    },
  },
}));
mock.module('../../config/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}));
mock.module('./task-budget', () => ({
  getTaskSpendUsd: () => Promise.resolve(0),
  getTaskSpendUsdSince: () => Promise.resolve(0),
}));
mock.module('../memory/concern-backlog-service', () => ({
  submitConcern: () => Promise.resolve({ id: 1, outcome: 'created' as const }),
}));

const { resolveIterationBudgetForTask } = await import('./task-iteration-budget');

const ENV_KEYS = [
  'RAPITAS_ITERATION_NO_PROGRESS_STATUS_REPEAT_MIN',
  'RAPITAS_ITERATION_NO_PROGRESS_ATTEMPTS_MIN',
  'RAPITAS_ITERATION_ATTEMPTS_BUDGET',
  'RAPITAS_ITERATION_TIME_BUDGET_MS',
  'RAPITAS_TASK_BUDGET_USD',
] as const;
const savedEnv: Record<string, string | undefined> = {};
beforeAll(() => {
  for (const k of ENV_KEYS) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
});
afterAll(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

let minute = 0;
function tr(fromStatus: string | null, toStatus: string, cause: string) {
  minute += 1;
  return {
    cause,
    createdAt: new Date(NOW - (60 - minute) * 30_000),
    actor: 'system',
    invariantViolation: null,
    fromStatus,
    toStatus,
  };
}

/** verify_repair ×4 → PR 作成 → マージ待ち(#1009 相当)。 */
function bounceTransitions() {
  minute = 0;
  return [
    tr('verify_done', 'in_progress', 'verify_repair'),
    tr('in_progress', 'verify_done', 'file_saved:verify'),
    tr('verify_done', 'in_progress', 'verify_repair'),
    tr('in_progress', 'verify_done', 'file_saved:verify'),
    tr('verify_done', 'in_progress', 'verify_repair'),
    tr('in_progress', 'verify_done', 'file_saved:verify'),
    tr('verify_done', 'in_progress', 'verify_repair'),
    tr('in_progress', 'verify_done', 'file_saved:verify'),
  ];
}
function bounceThenPr() {
  const xs = bounceTransitions();
  xs.push(tr('verify_done', 'verify_done', 'verify_passed_awaiting_ci'));
  xs.push(tr('verify_done', 'verify_done', 'verify_awaiting_required_merge'));
  return xs;
}

describe('resolveIterationBudgetForTask — PR 作成後', () => {
  test('差し戻し 4 回のあと PR 作成・マージ待ちは halt しない', async () => {
    taskRow = { workflowStatus: 'verify_done', createdAt: created, githubPrId: null };
    transitions = bounceThenPr();
    const state = await resolveIterationBudgetForTask(71001, {}, NOW);
    expect(state.shouldHalt).toBe(false);
    expect(state.haltReason).toBeUndefined();
  });

  test('verify_done + PR リンク済みなら halt しない', async () => {
    taskRow = { workflowStatus: 'verify_done', createdAt: created, githubPrId: 776 };
    transitions = bounceThenPr();
    const state = await resolveIterationBudgetForTask(71002, {}, NOW);
    expect(state.shouldHalt).toBe(false);
  });

  test('成功の後に ci_repair が 1 回だけなら halt しない', async () => {
    taskRow = { workflowStatus: 'in_progress', createdAt: created, githubPrId: 776 };
    const xs = bounceThenPr();
    xs.push(tr('verify_done', 'in_progress', 'ci_repair'));
    transitions = xs;
    const state = await resolveIterationBudgetForTask(71003, {}, NOW);
    expect(state.shouldHalt).toBe(false);
  });

  test('成功の後に ci_repair が反復すれば repeat_cause_detected', async () => {
    taskRow = { workflowStatus: 'in_progress', createdAt: created, githubPrId: 776 };
    const xs = bounceThenPr();
    xs.push(
      tr('verify_done', 'in_progress', 'ci_repair'),
      tr('in_progress', 'verify_done', 'file_saved:verify'),
      tr('verify_done', 'in_progress', 'ci_repair'),
      tr('in_progress', 'verify_done', 'file_saved:verify'),
      tr('verify_done', 'in_progress', 'ci_repair'),
    );
    transitions = xs;
    const state = await resolveIterationBudgetForTask(71004, {}, NOW);
    expect(state.haltReason).toBe('repeat_cause_detected');
  });

  test('成功 cause なしの verify_repair ×4 は従来どおり halt(回帰)', async () => {
    taskRow = { workflowStatus: 'verify_done', createdAt: created, githubPrId: null };
    transitions = bounceTransitions();
    const state = await resolveIterationBudgetForTask(71005, {}, NOW);
    expect(state.haltReason).toBe('repeat_cause_detected');
  });
});
