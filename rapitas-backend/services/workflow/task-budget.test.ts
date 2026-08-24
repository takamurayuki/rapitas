/**
 * task-budget.test
 *
 * Covers the per-task spend backstop: the ceiling tightens as a task spends,
 * but never stops it — stranding a task mid-workflow costs more than the phase
 * it would have run.
 */
import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';

const noopLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
const findManyMock = mock(() => Promise.resolve([] as Array<{ costUsd: unknown }>));

mock.module('../../config/database', () => ({
  prisma: { agentExecution: { findMany: findManyMock } },
  ensureDatabaseConnection: () => Promise.resolve(),
}));
mock.module('../../config/logger', () => ({
  createLogger: () => noopLogger,
  logger: noopLogger,
  getBackendLogFilePath: () => '/tmp/backend.log',
}));

const { resolveTaskBudgetCap, getTaskSpendUsd } = await import('./task-budget');

const spent = (...amounts: unknown[]) => amounts.map((costUsd) => ({ costUsd }));

describe('getTaskSpendUsd', () => {
  beforeEach(() => findManyMock.mockReset().mockResolvedValue([]));

  test('sums numeric, string and Decimal-ish costs', async () => {
    findManyMock.mockResolvedValue(spent(1.5, '2.25', '"3.25"'));
    expect(await getTaskSpendUsd(1)).toBeCloseTo(7, 5);
  });

  test('ignores nulls and unparseable values instead of throwing', async () => {
    findManyMock.mockResolvedValue(spent(null, undefined, 'n/a', -4, 2));
    expect(await getTaskSpendUsd(1)).toBe(2);
  });

  test('returns 0 when the read fails', async () => {
    findManyMock.mockImplementation(() => Promise.reject(new Error('db down')));
    expect(await getTaskSpendUsd(1)).toBe(0);
  });
});

describe('resolveTaskBudgetCap', () => {
  const original = process.env.RAPITAS_TASK_BUDGET_USD;
  beforeEach(() => {
    findManyMock.mockReset().mockResolvedValue([]);
    process.env.RAPITAS_TASK_BUDGET_USD = '25';
  });
  afterEach(() => {
    if (original === undefined) delete process.env.RAPITAS_TASK_BUDGET_USD;
    else process.env.RAPITAS_TASK_BUDGET_USD = original;
  });

  test('no cap while the task is within budget', async () => {
    findManyMock.mockResolvedValue(spent(10, 5));
    const r = await resolveTaskBudgetCap(1);
    expect(r.spentUsd).toBe(15);
    expect(r.capTier).toBeUndefined();
  });

  test('caps at standard once the budget is reached', async () => {
    findManyMock.mockResolvedValue(spent(20, 6));
    const r = await resolveTaskBudgetCap(1);
    expect(r.capTier).toBe('standard');
    expect(r.reason).toContain('予算超過');
  });

  test('tightens to economy when the spend runs away', async () => {
    // Task 658 spent $50.04 across four premium phases with nothing watching.
    findManyMock.mockResolvedValue(spent(5.77, 6.7, 28.27, 9.3));
    const r = await resolveTaskBudgetCap(658);
    expect(r.spentUsd).toBeCloseTo(50.04, 2);
    expect(r.capTier).toBe('economy');
  });

  test('a zero budget disables the cap entirely', async () => {
    process.env.RAPITAS_TASK_BUDGET_USD = '0';
    findManyMock.mockResolvedValue(spent(999));
    const r = await resolveTaskBudgetCap(1);
    expect(r.capTier).toBeUndefined();
    expect(r.spentUsd).toBe(999);
  });
});
