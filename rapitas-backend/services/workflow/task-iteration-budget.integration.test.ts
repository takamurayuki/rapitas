/**
 * task-iteration-budget integration テスト
 *
 * resolveIterationBudgetForTask を prisma モックで通し、task 984/986 相当の
 * 遷移列(reset→再実行で同じ status を 2 周)が既定閾値で halt されないこと、
 * 真の往復は no_progress で halt され diagnostics が付くことを検証する。
 */
import { describe, test, expect, mock, beforeAll, afterAll } from 'bun:test';

const NOW = 1_700_000_000_000;
const taskRow = { workflowStatus: 'verify_done', createdAt: new Date(NOW - 30 * 60_000) };
let transitions: Array<{
  cause: string | null;
  createdAt: Date;
  actor: string | null;
  invariantViolation: string | null;
  fromStatus: string | null;
  toStatus: string;
}> = [];
let attempts = 4;

// Partial mocks throw "export not found" at load time when this file runs on
// its own (the budget module's import chain reaches the config index).
mock.module('../../config/database', () => ({
  ensureDatabaseConnection: () => Promise.resolve(),
  prisma: {
    task: { findUnique: mock(() => Promise.resolve(taskRow)) },
    agentExecution: { count: mock(() => Promise.resolve(attempts)) },
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

describe('resolveIterationBudgetForTask — 既定閾値', () => {
  test('984/986 相当(reset を挟んだ 2 周の前進)は attempts 4 でも halt しない', async () => {
    minute = 0;
    attempts = 4;
    transitions = [
      tr('draft', 'research_done', 'phase_completed'),
      tr('research_done', 'in_progress', 'phase_completed'),
      tr('in_progress', 'verify_done', 'phase_completed'),
      tr('verify_done', 'draft', 'stale_terminal_reset'),
      tr('draft', 'research_done', 'phase_completed'),
      tr('research_done', 'in_progress', 'phase_completed'),
      tr('in_progress', 'verify_done', 'phase_completed'),
    ];
    const state = await resolveIterationBudgetForTask(70001, {}, NOW);
    expect(state.shouldHalt).toBe(false);
  });

  test('verify_done↔in_progress の往復は no_progress で halt し diagnostics を返す', async () => {
    minute = 0;
    attempts = 3;
    transitions = [
      tr('in_progress', 'verify_done', 'file_saved:verify'),
      tr('verify_done', 'in_progress', 'file_saved:impl'),
      tr('in_progress', 'verify_done', 'file_saved:verify'),
      tr('verify_done', 'in_progress', 'file_saved:impl'),
    ];
    const state = await resolveIterationBudgetForTask(70002, {}, NOW);
    expect(state.haltReason).toBe('no_progress');
    expect(state.diagnostics).toEqual({ statusRepeatCount: 2, attempts: 3, repeatLoop: null });
  });
});
