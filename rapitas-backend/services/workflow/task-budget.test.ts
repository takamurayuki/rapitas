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

const { resolveTaskBudgetCap, getTaskSpendUsd, getTaskSpendUsdSince } =
  await import('./task-budget');

const spent = (...amounts: unknown[]) => amounts.map((costUsd) => ({ costUsd }));

describe('getTaskSpendUsdSince', () => {
  beforeEach(() => findManyMock.mockReset().mockResolvedValue([]));

  // The window is applied to the INCREMENTS, not to the query. costUsd holds
  // the CLI's session-cumulative total_cost_usd (measured 2026-10-13: a resumed
  // session reports 0.00257 then 0.00456 with num_turns 1 each), so a chain
  // that began before the window must still be walked from its start — a
  // startedAt filter in SQL would make its first in-window row carry the whole
  // pre-window total. Hence this asserts the amount, not the where-clause.
  test('counts only spend inside the window, and reads the full history to do it', async () => {
    const since = new Date(2_000);
    findManyMock.mockResolvedValue([
      { costUsd: 1, claudeSessionId: 's1', startedAt: new Date(1_000) },
      { costUsd: 3, claudeSessionId: 's1', startedAt: new Date(3_000) },
    ]);

    // The session reported 1 before the window and 3 after it: 2 was spent
    // inside. Summing the rows would say 4, filtering them in SQL would say 3.
    expect(await getTaskSpendUsdSince(7, since)).toBe(2);
    const where = (findManyMock.mock.calls[0]?.[0] as { where: Record<string, unknown> }).where;
    expect(where).toEqual({ session: { config: { taskId: 7 } } });
  });

  test('executions that have not started yet count as in-window', async () => {
    findManyMock.mockResolvedValue([{ costUsd: 2, claudeSessionId: null, startedAt: null }]);
    expect(await getTaskSpendUsdSince(7, new Date(9_000))).toBe(2);
  });

  test('null `since` means lifetime (no startedAt filter)', async () => {
    await getTaskSpendUsdSince(7, null);
    const where = (findManyMock.mock.calls[0]?.[0] as { where: Record<string, unknown> }).where;
    expect(where).toEqual({ session: { config: { taskId: 7 } } });
  });
});

describe('getTaskSpendUsd', () => {
  beforeEach(() => findManyMock.mockReset().mockResolvedValue([]));

  test('sums numeric, string and Decimal-ish costs', async () => {
    findManyMock.mockResolvedValue(spent(1.5, '2.25', '"3.25"'));
    expect(await getTaskSpendUsd(1)).toBeCloseTo(7, 5);
  });

  // 実測 2026-10-13: #1214 のこのチェーン（claudeSessionId 5ad76864、5実行）を
  // 合算すると $27.42 になるが、実際の支出は最終報告の $8.86。予算 $25 を
  // 超えたとして halt された #1160（真 $13.13）と #1174（真 $17.96）は、
  // どちらもこの多重計上による誤 halt だった。
  test('実測: 同一セッションの累計報告を二重に数えない', async () => {
    findManyMock.mockResolvedValue(
      [1.94, 4.2, 5.97, 6.45, 8.86].map((costUsd, i) => ({
        costUsd,
        claudeSessionId: '5ad76864',
        startedAt: new Date(1_000 + i),
      })),
    );
    expect(await getTaskSpendUsd(1214)).toBeCloseTo(8.86, 5);
  });

  test('ignores nulls and unparseable values instead of throwing', async () => {
    findManyMock.mockResolvedValue(spent(null, undefined, 'n/a', -4, 2));
    expect(await getTaskSpendUsd(1)).toBe(2);
  });

  test('rejects instead of returning 0 when the read fails', async () => {
    findManyMock.mockImplementation(() => Promise.reject(new Error('db down')));
    expect(getTaskSpendUsd(1)).rejects.toThrow('db down');
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

  test('DB失敗時はunknownを返し、0扱い(no-cap相当)にはしない', async () => {
    findManyMock.mockImplementation(() => Promise.reject(new Error('db down')));
    const r = await resolveTaskBudgetCap(1);
    expect(r.spendUnknown).toBe(true);
    expect(r.unknownReason).toBeTruthy();
    expect(r.unknownReason).toContain('db down');
    // Tier judgement is deferred, not resolved to "no ceiling" — capTier
    // stays unset either way, but the reason field distinguishes it from a
    // genuinely empty spend history.
    expect(r.capTier).toBeUndefined();
  });

  test('DB回復後は次回呼び出しで正常なtier判定に自動復帰する', async () => {
    findManyMock.mockImplementationOnce(() => Promise.reject(new Error('db down')));
    const failed = await resolveTaskBudgetCap(1);
    expect(failed.spendUnknown).toBe(true);

    findManyMock.mockResolvedValue(spent(20, 6));
    const recovered = await resolveTaskBudgetCap(1);
    expect(recovered.spendUnknown).toBeUndefined();
    expect(recovered.capTier).toBe('standard');
  });
});
